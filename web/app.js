
const screen = document.querySelector('#screen');
const dialog = document.querySelector('#schedule');
const form = document.querySelector('#form');
const deleteDialog = document.querySelector('#delete-dialog');
const dateKey = date => [date.getFullYear(), date.getMonth()+1, date.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
let items;
let courses;
let page = 'today';
const store = PiData.create({courses:[],items:[]});
let viewDate = dateKey(new Date());
function shiftDate(date, days) {
  const result = new Date(date + 'T12:00:00');
  result.setDate(result.getDate() + days);
  return result;
}
function entriesForDate(date) {
  const weekday = (shiftDate(date, 0).getDay() + 6) % 7;
  return [
    ...courses.filter(course => course.day === weekday && (!course.weeks || course.weeks.includes(
      Math.floor((Date.parse(date)-Date.parse(course.termStart))/604800000)+1))).map(course => ({...course, kind:'courses'})),
    ...items.filter(item => item.date === date).map(item => ({...item, kind:'items'}))
  ].sort((a, b) => a.time.localeCompare(b.time));
}
let editingId = null;
let editingKind = 'items';
let editingRevision = 0;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char=>({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));
function refreshData() {
  const snapshot = store.snapshot();
  items = snapshot.items;
  courses = snapshot.courses;
  if (!store.error) window.PiReminders?.replace(JSON.stringify({items:items.filter(item=>!item.completed),courses}));
}
refreshData();
function message(text) {
  document.querySelector('#app-message').textContent = text;
  clearTimeout(message.timer);
  message.timer = setTimeout(()=>document.querySelector('#app-message').textContent='', 6500);
}
for (const prefix of ['time','end']) {
  for (const [part, count, label] of [['Hour',24,'时'],['Minute',60,'分']]) {
    const select = form.elements[prefix+part];
    for (let number = 0; number < count; number++) {
      const value = String(number).padStart(2,'0');
      select.add(new Option(value+label, value));
    }
  }
}
function setEditorTime(prefix, time) {
  const [hour, minute] = time.split(':');
  form.elements[prefix+'Hour'].value = hour;
  form.elements[prefix+'Minute'].value = minute;
}
function editorTime(prefix) {
  return form.elements[prefix+'Hour'].value+':'+form.elements[prefix+'Minute'].value;
}
form.addEventListener('change', event => {
  if (event.target.name === 'timeHour' || event.target.name === 'timeMinute') {
    setEditorTime('end', PiData.endAfter(editorTime('time')));
  }
});
function openEditor(kind, id = null) {
  editingKind = kind;
  editingId = id;
  editingRevision = store.snapshot().revision;
  const record = id ? store.snapshot()[kind].find(row=>row.id===id) : null;
  document.querySelector('#schedule-title').textContent = kind==='courses' ? '修改每周课程' : id ? '修改日程' : '新建日程';
  form.reset();
  document.querySelector('#delete-item').hidden = kind !== 'items' || !record;
  form.elements.name.value = record?.name || '';
  form.elements.date.value = record?.date || viewDate;
  setEditorTime('time', record?.time || '14:00');
  setEditorTime('end', record?.end || '15:00');
  form.elements.day.value = record?.day ?? 0;
  form.elements.room.value = record?.room || '';
  document.querySelector('#date-field').hidden = kind==='courses';
  document.querySelector('#day-field').hidden = kind!=='courses';
  form.elements.date.disabled = kind==='courses';
  document.querySelector('#edit-error').textContent = '';
  dialog.showModal();
}
function renderToday() {
  const rows = entriesForDate(viewDate);
  const clock = new Date().toTimeString().slice(0,5);
  const next = rows.filter(row=>!row.completed).find(row=>viewDate!==dateKey(new Date()) || row.end>clock);
  return `
    <div class="page-heading"><h1>${viewDate===dateKey(new Date())?'今天':'日程'}</h1><button id="new-item" class="action">新建日程</button></div>
    <label class="date-picker">查看日期<input id="view-date" type="date" value="${viewDate}" required></label>
    <section class="feature"><small>${viewDate===dateKey(new Date())?'当前或接下来的安排':'当日日程'}</small><strong>${next ? escapeHtml(next.name) : '暂无待办安排'}</strong>${next ? '<p>'+next.time+'–'+next.end+' · '+escapeHtml(next.room)+'</p>' : '<button class="secondary" id="empty-add">安排一件事</button>'}</section>
    <h2>日程列表</h2>
    ${rows.map(row=>'<div class="row"><time>'+row.time+'</time><div class="card"><b>'+escapeHtml(row.name)+'</b><small>'+row.time+'–'+row.end+' · '+escapeHtml(row.room)+'</small><div class="row-actions"><button class="secondary" data-edit="'+escapeHtml(row.id)+'" data-kind="'+row.kind+'">修改</button>'+completionButton(row)+'</div></div></div>').join('')}
  `;
}
function completionButton(row) {
  if (row.kind !== 'items') return '';
  return '<button class="secondary completion" aria-pressed="'+Boolean(row.completed)+'" data-complete="'+escapeHtml(row.id)+'">'+
    (row.completed ? '已完成 · 撤销' : '标记完成')+'</button>';
}
function duration(rows) {
  const minutes = time => Number(time.slice(0,2))*60+Number(time.slice(3));
  const total = rows.reduce((sum,row)=>sum+minutes(row.end)-minutes(row.time),0);
  return Math.floor(total/60)+' 小时 '+total%60+' 分钟';
}
function renderSummary() {
  const monday = dateKey(shiftDate(viewDate, -(shiftDate(viewDate,0).getDay()+6)%7));
  const dates = Array.from({length:7}, (_,index)=>dateKey(shiftDate(monday,index)));
  const rows = items.filter(item=>item.date>=dates[0] && item.date<=dates[6]);
  const weekCourses = dates.flatMap(date=>entriesForDate(date).filter(row=>row.kind==='courses'));
  const complete = rows.filter(item=>item.completed);
  const now = new Date();
  const overdue = rows.filter(item=>!item.completed && new Date(item.date+'T'+item.end)<now).length;
  const rate = rows.length ? Math.round(100*complete.length/rows.length)+'%' : '—';
  return '<h1>周总结</h1><div class="controls"><button data-summary-shift="-1" aria-label="上一周">‹</button><b>'+dates[0]+' 至 '+dates[6]+'</b><button data-summary-shift="1" aria-label="下一周">›</button><button data-summary-shift="0">本周</button></div>'+
    '<section class="feature"><small>个人日程完成率（已完成 ÷ 本周日程总数）</small><strong>'+rate+'</strong><p>已完成 '+complete.length+' / '+rows.length+' · 待完成 '+(rows.length-complete.length)+' · 其中逾期 '+overdue+'</p></section>'+
    '<h2>时间安排</h2><section class="card"><p>个人日程 '+duration(rows)+' · 已完成 '+duration(complete)+'</p><p>课程 '+weekCourses.length+' 节 · '+duration(weekCourses)+'</p></section>'+
    '<h2>每日进度</h2><div class="card">'+dates.map(date=>{
      const day = rows.filter(item=>item.date===date);
      const classes = entriesForDate(date).filter(row=>row.kind==='courses').length;
      return '<div class="summary-day"><button class="secondary" data-date="'+date+'">'+date.slice(5)+'</button><span>日程 '+day.filter(item=>item.completed).length+' / '+day.length+' · 课程 '+classes+' 节</span></div>';
    }).join('')+'</div>';
}
function layoutCourses(dayCourses) {
  const sorted = dayCourses.map(course=>({...course})).sort((a,b)=>a.time.localeCompare(b.time));
  let group = [];
  let laneEnds = [];
  let groupEnd = '';
  const finishGroup = () => group.forEach(course=>course.lanes=laneEnds.length);
  for (const course of sorted) {
    if (course.time >= groupEnd) {
      finishGroup();
      group = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex(end=>end<=course.time);
    if (lane < 0) lane = laneEnds.length;
    course.lane = lane;
    laneEnds[lane] = course.end;
    group.push(course);
    groupEnd = laneEnds.reduce((end,value)=>value>end?value:end,'');
  }
  finishGroup();
  return sorted;
}
function render() {
  document.querySelectorAll('nav button').forEach(button=>{
    if(button.dataset.page===page) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  if (page === 'summary') {
    screen.innerHTML = renderSummary();
    return;
  }
  if (page === 'about') {
    screen.replaceChildren(document.querySelector('#about-page').content.cloneNode(true));
    return;
  }
  if(page==='today'){
    screen.innerHTML = renderToday();
  } else if(page==='week'){
    const today = dateKey(new Date());
    const weekday = (shiftDate(viewDate, 0).getDay() + 6) % 7;
    const monday = dateKey(shiftDate(viewDate, -weekday));
    const days = [...'一二三四五六日'].map((day,index)=>{
      const date = shiftDate(monday, index);
      return {label:'周'+day, date:dateKey(date), short:(date.getMonth()+1)+'/'+date.getDate()};
    });
    const weekEntries = days.map(day => entriesForDate(day.date));
    const entries = weekEntries.flat();
    const startHour = Math.min(8, ...entries.map(course=>Number(course.time.slice(0,2))));
    const endHour = Math.max(22, ...entries.map(course=>Math.ceil((Number(course.end.slice(0,2))*60+Number(course.end.slice(3)))/60)));
    const position = time => {
      const [hour, minute] = time.split(':').map(Number);
      return (hour-startHour+minute/60)*64;
    };
    const hours = Array.from({length:endHour-startHour+1},(_,index)=>
      `<time style="top:${index*64}px">${String(index+startHour).padStart(2,'0')}:00</time>`
    ).join('');
    const columns = days.map((day,index)=>{
      const lessons = layoutCourses(weekEntries[index]).map(course=>
        `<button data-edit="${escapeHtml(course.id)}" data-kind="${course.kind}" title="${escapeHtml(course.name)} ${course.time}–${course.end} ${escapeHtml(course.room)}" class="week-event ${course.kind==='items'?'personal-event':['blue','peach'].includes(course.color)?course.color:''}" style="left:calc(${course.lane/course.lanes*100}% + 4px);width:calc(${100/course.lanes}% - 8px);top:${position(course.time)}px;height:${position(course.end)-position(course.time)}px"><b>${escapeHtml(course.name)}</b><time>${course.time}–${course.end}</time><small>${escapeHtml(course.room)}</small></button>`
      ).join('');
      return `<section class="week-day${day.date===today?' current':''}" aria-label="${day.label} ${day.short}">${lessons}</section>`;
    }).join('');
    screen.innerHTML = `<div class="page-heading"><h1>课表</h1><button id="open-import" class="secondary">导入 Excel</button></div><div class="controls"><button data-shift="-1" aria-label="上一周">‹</button><b>${days[0].short} – ${days[6].short}</b><button data-shift="1" aria-label="下一周">›</button><button data-shift="0">本周</button></div><div class="week-scroll" role="region" tabindex="0" aria-label="周课表" style="--grid-height:${(endHour-startHour)*64}px"><div class="week-grid"><div class="week-head"><div>时间</div>${days.map(day=>`<div${day.date===today?' class="current" aria-current="date"':''}><button type="button" class="week-date" data-date="${day.date}" ${day.date===viewDate?'aria-pressed="true"':''} aria-label="查看 ${day.date} 的日程">${day.label}<br><small>${day.short}</small></button></div>`).join('')}</div><div class="week-body"><div class="week-hours">${hours}</div>${columns}</div></div></div>`;
  }
}
document.addEventListener('click',event=>{
  const button = event.target.closest('button');
  if(!button) return;
  const destination = button.dataset.page;
  if(destination){page=destination;render();window.scrollTo(0,0);}
  if (button.dataset.summaryShift) {
    viewDate = button.dataset.summaryShift==='0' ? dateKey(new Date()) : dateKey(shiftDate(viewDate, Number(button.dataset.summaryShift)*7));
    render();
    return;
  }
  if (button.dataset.complete) {
    try {
      const snapshot = store.snapshot();
      const item = snapshot.items.find(row=>row.id===button.dataset.complete);
      if (!item) return;
      item.completed = !item.completed;
      store.replace(snapshot);
      refreshData();
      render();
      Array.from(document.querySelectorAll('[data-complete]')).find(control=>control.dataset.complete===item.id)?.focus();
    } catch (error) { message(error.message); }
    return;
  }
  if(button.dataset.shift){
    const grid = document.querySelector('.week-scroll');
    const {scrollTop, scrollLeft} = grid;
    viewDate = button.dataset.shift==='0' ? dateKey(new Date()) : dateKey(shiftDate(viewDate, Number(button.dataset.shift)*7));
    render();
    document.querySelector('.week-scroll').scrollTo(scrollLeft,scrollTop);
    document.querySelector('[data-shift="'+button.dataset.shift+'"]').focus();
  }
  if (button.dataset.date) {
    viewDate = button.dataset.date;
    page = 'today';
    render();
    window.scrollTo(0, 0);
    document.querySelector('#view-date').focus({preventScroll:true});
  }
  if(button.id==='new-item' || button.id==='empty-add') openEditor('items');
  if(button.dataset.edit) openEditor(button.dataset.kind,button.dataset.edit);
  if(button.id==='cancel') dialog.close();
  if (button.id === 'delete-item' && editingKind === 'items' && editingId) {
    const item = store.snapshot().items.find(row => row.id === editingId);
    if (!item) return;
    document.querySelector('#delete-description').textContent = '确定删除「' + item.name + '」？删除后无法恢复。';
    document.querySelector('#delete-error').textContent = '';
    deleteDialog.showModal();
  }
  if (button.id === 'keep-item') deleteDialog.close();
  if (button.id === 'confirm-delete' && deleteDialog.open) {
    try {
      const snapshot = store.snapshot();
      snapshot.items = snapshot.items.filter(row => row.id !== editingId);
      store.replace(snapshot, editingRevision);
      refreshData();
      deleteDialog.close();
      dialog.close();
      render();
      message('已删除日程。');
    } catch (error) {
      document.querySelector('#delete-error').textContent = error.message;
    }
  }
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  values.time = editorTime('time');
  values.end = editorTime('end');
  const error = document.querySelector('#edit-error');
  try {
    if (!values.name.trim()) throw Error('请填写名称。');
    if (values.end <= values.time) throw Error('结束时间必须晚于开始时间。');
    const snapshot = store.snapshot();
    const previous = snapshot[editingKind].find(row=>row.id===editingId);
    const record = {
      ...previous, id:editingId || PiData.id(), name:values.name.trim(),
      time:values.time, end:values.end, room:values.room.trim()
    };
    if (editingKind === 'courses') record.day = Number(values.day);
    else record.date = values.date;
    if (editingId) snapshot[editingKind] = snapshot[editingKind].map(row=>row.id===editingId ? record : row);
    else snapshot[editingKind].push(record);
    store.replace(snapshot, editingRevision);
    refreshData();
    if (editingKind === 'items') viewDate = record.date;
    dialog.close();
    render();
    message('已保存。');
  } catch (cause) {
    error.textContent = '保存失败：'+cause.message;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'view-date' && PiData.validDate(event.target.value)) {
    viewDate = event.target.value;
    render();
  }
});

const importDialog = document.querySelector('#import-dialog');
const fileInput = document.querySelector('#excel-file');
const sheetSelect = document.querySelector('#sheet-select');
const importError = document.querySelector('#import-error');
const importPreview = document.querySelector('#import-preview');
const importConfirm = document.querySelector('#confirm-import');
const termStart = document.querySelector('#term-start');
const termField = document.querySelector('#term-field');
let workbook = null;
let importResult = null;
let importRevision = 0;
let importToken = 0;

function previewImport() {
  importResult = null;
  importConfirm.disabled = true;
  importError.textContent = '';
  importPreview.innerHTML = '';
  termField.hidden = true;
  try {
    const sheet = workbook.Sheets[sheetSelect.value];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r >= 10001 || range.e.c >= 200) throw Error('课表最多支持 10000 行、200 列。');
    const result = PiImport.parseSheet(sheet, termStart.value);
    termField.hidden = !result.grid;
    const currentKeys = new Set(courses.map(PiImport.fingerprint));
    const additions = result.courses.filter(course=>!currentKeys.has(PiImport.fingerprint(course)));
    const duplicateCount = result.duplicates + result.courses.length - additions.length;
    importPreview.innerHTML = '<p>新增 '+additions.length+' 节课程，跳过 '+duplicateCount+' 条重复记录。</p>'+
      '<table><thead><tr><th>课程</th><th>星期</th><th>时间</th><th>教室</th><th>教学周</th></tr></thead><tbody>'+
      additions.slice(0,100).map(course=>'<tr><td>'+escapeHtml(course.name)+(course.teacher?' · '+escapeHtml(course.teacher):'')+'</td><td>周'+ '一二三四五六日'[course.day]+'</td><td>'+course.time+'–'+course.end+'</td><td>'+escapeHtml(course.room)+'</td><td>'+(course.weeks?.join(', ') || '每周')+'</td></tr>').join('')+
      '</tbody></table>'+(additions.length>100?'<p>预览显示前 100 条。</p>':'');
    if (result.errors.length) throw Error(result.errors.slice(0,20).join('\n')+(result.errors.length>20?'\n还有更多错误，请检查原表。':''));
    if (result.grid && (!PiData.validDate(termStart.value) || shiftDate(termStart.value,0).getDay() !== 1)) {
      throw Error('请填写第 1 教学周的周一日期。');
    }
    if (!additions.length) throw Error('没有可新增的课程。');
    importResult = additions;
    importConfirm.disabled = false;
  } catch (cause) { importError.textContent = cause.message; }
}
fileInput.addEventListener('change', async () => {
  const token = ++importToken;
  workbook = null;
  importResult = null;
  importConfirm.disabled = true;
  importError.textContent = '';
  importPreview.innerHTML = '';
  document.querySelector('#sheet-field').hidden = true;
  termField.hidden = true;
  const file = fileInput.files[0];
  if (!file) return;
  try {
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw Error('请选择 .xls 或 .xlsx 文件。');
    if (file.size > 10*1024*1024) throw Error('文件超过 10 MB，请拆分后导入。');
    importPreview.textContent = '正在读取课表…';
    const buffer = await file.arrayBuffer();
    if (token !== importToken) return;
    const bytes = new Uint8Array(buffer);
    const binaryExcel = bytes[0]===0xd0 && bytes[1]===0xcf && bytes[2]===0x11 && bytes[3]===0xe0;
    const zippedExcel = bytes[0]===0x50 && bytes[1]===0x4b;
    if (!binaryExcel && !zippedExcel) throw Error('文件内容不是受支持的 Excel 工作簿，请在 Excel 中另存为 .xlsx 后重试。');
    workbook = XLSX.read(buffer, {type:'array',sheetRows:10002,cellFormula:false,cellHTML:false});
    if (!workbook.SheetNames.length) throw Error('文件中没有工作表。');
    sheetSelect.replaceChildren(...workbook.SheetNames.map(name=>{
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    document.querySelector('#sheet-field').hidden = false;
    previewImport();
  } catch (cause) {
    importPreview.innerHTML = '';
    importError.textContent = '读取失败：'+cause.message;
  }
});
sheetSelect.addEventListener('change', previewImport);
termStart.addEventListener('change', () => { if (workbook) previewImport(); });
importDialog.addEventListener('close',()=>{ importToken++; workbook=null; importResult=null; });
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'open-import') {
    importRevision = store.snapshot().revision;
    fileInput.value = '';
    importError.textContent = '';
    importPreview.innerHTML = '';
    document.querySelector('#sheet-field').hidden = true;
  termField.hidden = true;
    importConfirm.disabled = true;
    importDialog.showModal();
  }
  if (button.id === 'cancel-import') importDialog.close();
  if (button.id === 'confirm-import' && importResult) {
    try {
      const snapshot = store.snapshot();
      const count = importResult.length;
      snapshot.courses.push(...importResult);
      store.replace(snapshot, importRevision);
      refreshData();
      importDialog.close();
      render();
      message('已导入 '+count+' 条课程记录。');
    } catch (cause) { importError.textContent = '导入失败：'+cause.message; }
  }
});
render();
if (store.error) message(store.error);
window.handleAndroidBack = () => {
  const openDialog = deleteDialog.open ? deleteDialog : document.querySelector('dialog[open]');
  if (openDialog) { openDialog.close(); return true; }
  if (page !== 'today') { page='today'; render(); return true; }
  return false;
};

window.showReminderStatus = (status, ready, notifications) => {
  document.querySelector('#reminder-settings').hidden = false;
  document.querySelector('#reminder-status').textContent = status;
  document.querySelector('#enable-reminders').hidden = ready;
  document.querySelector('#test-reminder').hidden = !notifications;
};
document.querySelector('#enable-reminders').addEventListener('click', () => window.PiReminders?.openSettings());
window.PiReminders?.refreshStatus();

document.querySelector('#test-reminder').addEventListener('click', () => window.PiReminders?.testNotification());
