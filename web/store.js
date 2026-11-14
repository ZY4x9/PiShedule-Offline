/* Shared local data boundary for the browser and Android WebView. */
window.PiData = (() => {
  const native = window.PiDatabase;
  const key = 'pischedule-offline-v1';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const id = () => crypto.randomUUID();
  function validDate(value) {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const date = new Date(value + 'T12:00:00');
    return !Number.isNaN(date.valueOf()) && date.getFullYear() === Number(value.slice(0,4)) &&
      date.getMonth()+1 === Number(value.slice(5,7)) && date.getDate() === Number(value.slice(8));
  }
  function text(value, max = 200) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0) throw Error('数据版本无效。');
    for (const name of ['items','courses']) {
      if (!Array.isArray(data[name]) || data[name].length > 10000) throw Error('数据列表无效。');
      const ids = new Set();
      for (const row of data[name]) {
        if (!row || !text(row.id) || ids.has(row.id) || !text(row.name)) throw Error('记录名称或标识无效。');
        ids.add(row.id);
        if (!timePattern.test(row.time) || !timePattern.test(row.end) ||
            row.end < row.time || (name === 'courses' && row.end === row.time)) throw Error('日程时间范围无效。');
        if (typeof row.room !== 'string' || row.room.length > 200) throw Error('地点过长。');
        if (name === 'items' && !validDate(row.date)) throw Error('日程日期无效。');
        if (name === 'courses' && (!Number.isInteger(row.day) || row.day < 0 || row.day > 6)) throw Error('课程星期无效。');
        if (name === 'courses' && row.weeks !== undefined &&
            (!validDate(row.termStart) || new Date(row.termStart+'T12:00:00').getDay() !== 1 ||
             !Array.isArray(row.weeks) || !row.weeks.length || row.weeks.length > 60 ||
             row.weeks.some(week=>!Number.isInteger(week) || week < 1 || week > 60))) throw Error('教学周无效。');
      }
    }
    return data;
  }
  function endAfter(time) {
    const [hour, minute] = time.split(':').map(Number);
    const total = Math.min(hour * 60 + minute + 60, 1439);
    return String(Math.floor(total/60)).padStart(2,'0') + ':' + String(total%60).padStart(2,'0');
  }
  function create(defaults) {
    let state;
    let readOnly = false;
    let error = '';
    try {
      const databaseState = native?.readSchedule();
      const saved = databaseState ?? localStorage.getItem(key);
      if (saved !== null) {
        state = validate(JSON.parse(saved));
      } else {
        const legacy = JSON.parse(localStorage.getItem('pischedule-items') || 'null');
        if (legacy !== null && !Array.isArray(legacy)) throw Error('旧日程数据格式无效。');
        state = {
          schemaVersion:1, revision:0,
          courses:defaults.courses.map(row=>({...row,id:id()})),
          items:(legacy ?? defaults.items).map(row=>({
            ...row, id:row.id || id(), end:row.end || endAfter(row.time)
          }))
        };
        validate(state);
        if (!native) localStorage.setItem(key, JSON.stringify(state));
      }
      if (native && databaseState == null && !native.saveSchedule(JSON.stringify(state), -1)) throw Error("数据库初始化失败。");
    } catch (cause) {
      // Keep invalid or inaccessible storage intact for recovery.
      error = '本地数据无法读取或保存，请检查浏览器存储权限。' + cause.message;
      readOnly = true;
      state = {schemaVersion:1,revision:0,items:[],courses:[]};
    }
    return {
      error,
      snapshot: () => structuredClone(state),
      replace(next, expectedRevision = state.revision) {
        if (readOnly) throw Error(error);
        const disk = native ? native.readSchedule() : localStorage.getItem(key);
        if (!disk || JSON.parse(disk).revision !== expectedRevision || state.revision !== expectedRevision) {
          throw Error('数据已在其他窗口更新，请刷新后重试。');
        }
        const candidate = validate({...structuredClone(next),schemaVersion:1,revision:state.revision+1});
        if (native) {
          if (!native.saveSchedule(JSON.stringify(candidate), expectedRevision)) throw Error("数据库保存失败，请重新打开应用。");
        } else localStorage.setItem(key, JSON.stringify(candidate));
        state = candidate;
        return this.snapshot();
      }
    };
  }
  return {create, validate, id, validDate, endAfter};
})();
