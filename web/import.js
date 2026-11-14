/* Accept one course per row. Parse all rows before committing any data. */
window.PiImport = (() => {
  const fields = {
    name:['课程名','课程名称','课程','name'],
    day:['星期','星期几','周几','day'],
    time:['开始时间','上课时间','开始','start'],
    end:['结束时间','下课时间','结束','end'],
    room:['教室','地点','上课地点','room']
  };
  function parseTime(value) {
    if (typeof value === 'number' && value >= 0 && value < 1) {
      const minutes = Math.round(value * 1440);
      if (minutes >= 1440) throw Error('时间应在 00:00 至 23:59 之间');
      return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
    }
    const match = String(value ?? '').trim().replace('：',':').match(/^(\d{1,2}):(\d{2})(?::00)?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw Error('时间请填写 HH:mm 或 Excel 时间值');
    return match[1].padStart(2,'0')+':'+match[2];
  }
  function parseDay(value) {
    const raw = String(value ?? '').trim().replace(/^(星期|周|礼拜)/,'');
    if (/^[1-7]$/.test(raw)) return Number(raw)-1;
    const day = ['一','二','三','四','五','六','日'].indexOf(raw === '天' ? '日' : raw);
    if (day < 0) throw Error('星期请填写周一至周日，或数字 1 至 7');
    return day;
  }
  function fingerprint(course) {
    return JSON.stringify([course.name,course.day,course.time,course.end,course.room,course.teacher ?? "",course.termStart ?? "",course.weeks ?? []]);
  }

  function parseGrid(rows, headerIndex, termStart) {
    const courses = [], errors = [], seen = new Set();
    let duplicates = 0;
    const days = rows[headerIndex].map(value => /^星期[一二三四五六日天]$/.test(String(value).trim()) ? parseDay(value) : null);
    const clock = /\b(\d{1,2}[:：]\d{2})\s*[-–—~～至]\s*(\d{1,2}[:：]\d{2})\b/;
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const timeRange = String(row[0]).match(clock);
      if (!timeRange) {
        if (days.some((day, col) => day !== null && String(row[col] ?? '').includes('[周]'))) {
          errors.push('第 '+(rowIndex+1)+' 行缺少节次起止时间。');
        }
        continue;
      }
      for (let col = 0; col < days.length; col++) {
        const day = days[col];
        const cell = String(row[col] ?? '').trim();
        if (day === null || !cell) continue;
        const address = XLSX.utils.encode_cell({r:rowIndex,c:col});
        try {
          const time = parseTime(timeRange[1]), end = parseTime(timeRange[2]);
          if (end <= time) throw Error('结束时间必须晚于开始时间');
          const sections = cell.split(/[\[［]\d+(?:\s*[-–—]\s*\d+)?[\]］]\s*节/);
          if (sections.length < 2 || sections.pop().trim()) throw Error('未识别到完整的课程节次');
          for (const section of sections) {
            const parts = section.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
            const weekIndex = parts.findIndex(line=>/[\[［]周[\]］]$/.test(line));
            if (weekIndex < 2) throw Error('缺少课程名、教师或教学周');
            const weekSpec = parts[weekIndex].replace(/[\[［]周[\]］]$/, '').replace(/\s/g, '');
            const weeks = new Set();
            for (const token of weekSpec.split(/[,，、]/)) {
              const match = token.match(/^(\d{1,2})(?:[-–—](\d{1,2}))?$/);
              if (!match) throw Error('无法识别教学周：'+token);
              const first = Number(match[1]), last = Number(match[2] || match[1]);
              if (first < 1 || first > last || last > 60) throw Error('教学周范围无效');
              for (let week = first; week <= last; week++) weeks.add(week);
            }
            const name = parts.slice(0, weekIndex-1).join(' ');
            const teacher = parts[weekIndex-1];
            const room = parts.slice(weekIndex+1).join(' ');
            if (name.length > 200 || room.length > 200) throw Error('课程名和教室最多 200 字');
            const course = {id:PiData.id(),name,teacher,room,day,time,end,color:'',termStart,weeks:[...weeks].sort((a,b)=>a-b)};
            const key = fingerprint(course);
            if (seen.has(key)) { duplicates++; continue; }
            seen.add(key);
            courses.push(course);
          }
        } catch (cause) { errors.push(address+'：'+cause.message); }
      }
    }
    if (!courses.length && !errors.length) throw Error('未找到可导入的课程。');
    return {courses, errors, duplicates, grid:true};
  }
  function parseSheet(sheet, termStart) {
    const rows = XLSX.utils.sheet_to_json(sheet, {header:1,defval:'',raw:true,blankrows:true});
    if (rows.length > 10001) throw Error('每张表最多支持 10000 行。');
    const headerIndex = rows.findIndex(row => Object.values(fields).slice(0,4).every(
      aliases => row.some(value => aliases.includes(String(value).trim().toLowerCase()))
    ));
    if (headerIndex < 0) {
      const gridHeader = rows.findIndex(row => new Set(row.filter(value =>
        /^星期[一二三四五六日天]$/.test(String(value).trim())).map(parseDay)).size === 7);
      if (gridHeader >= 0) return parseGrid(rows, gridHeader, termStart);
      throw Error('未识别到课表。请选择学生个人课表，或包含课程名、星期、开始时间和结束时间的明细表。');
    }
    const headers = rows[headerIndex].map(value=>String(value).trim().toLowerCase());
    const columns = Object.fromEntries(Object.entries(fields).map(([field,aliases])=>[
      field, headers.findIndex(value=>aliases.includes(value))
    ]));
    const errors = [];
    const courses = [];
    const seen = new Set();
    let duplicates = 0;
    rows.slice(headerIndex+1).forEach((row,index)=>{
      if (row.every(value=>String(value).trim()==='')) return;
      try {
        const name = String(row[columns.name] ?? '').trim();
        const room = String(row[columns.room] ?? '').trim();
        if (!name || name.length > 200 || room.length > 200) throw Error('课程名不能为空，课程名和教室最多 200 字');
        const course = {id:PiData.id(),name,room,day:parseDay(row[columns.day]),time:parseTime(row[columns.time]),end:parseTime(row[columns.end]),color:''};
        if (course.end <= course.time) throw Error('结束时间必须晚于开始时间，不支持跨天课程');
        const key = fingerprint(course);
        if (seen.has(key)) { duplicates++; return; }
        seen.add(key);
        courses.push(course);
      } catch (cause) { errors.push('第 '+(headerIndex+index+2)+' 行：'+cause.message); }
    });
    if (!courses.length && !errors.length) throw Error('表格中没有课程。');
    return {courses, errors, duplicates};
  }
  return {parseSheet, fingerprint};
})();
