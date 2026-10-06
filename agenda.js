const EVENTS_KEY='agendaEvents', TASKS_KEY='agendaTasks';
const $=id=>document.getElementById(id);
const eventDialog=$('eventDialog'), eventForm=$('eventForm'), taskDialog=$('taskDialog'), taskForm=$('taskForm');
let currentMonth=new Date(); currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth(),1);

function iso(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function dt(e,dateKey='date'){return new Date(e[dateKey]+'T'+(e.time||'00:00'));}
function fmt(s){const p=s.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(new Date(p[0],p[1]-1,p[2],12));}
async function load(k){const r=await chrome.storage.local.get(k);return r[k]||[];}
async function save(k,v){await chrome.storage.local.set({[k]:v});}
function recurLabel(v){return {daily:'Diário',weekly:'Semanal',monthly:'Mensal'}[v]||'';}
function advance(d,r){const n=new Date(d);if(r==='daily')n.setDate(n.getDate()+1);if(r==='weekly')n.setDate(n.getDate()+7);if(r==='monthly')n.setMonth(n.getMonth()+1);return n;}
function occurrences(e,start,end,max=400){
  const first=dt(e);
  if(!e.recurrence||e.recurrence==='none')return first>=start&&first<=end?[Object.assign({},e,{occurrenceDate:e.date})]:[];
  const until=e.repeatUntil?new Date(e.repeatUntil+'T23:59:59'):end, hard=until<end?until:end, out=[];
  let cur=new Date(first),g=0;
  while(cur<=hard&&g++<max){if(cur>=start)out.push(Object.assign({},e,{occurrenceDate:iso(cur)}));cur=advance(cur,e.recurrence);}
  return out;
}
async function stats(){const [e,t]=await Promise.all([load(EVENTS_KEY),load(TASKS_KEY)]);$('totalEvents').textContent=e.length;$('openTasks').textContent=t.filter(x=>!x.completed).length;}
function switchView(v){
  ['calendar','list','tasks'].forEach(x=>{
    $(x+'View').classList.toggle('hidden',x!==v);
    $(x+'ViewBtn').classList.toggle('active',x===v);
    document.querySelector('.side-nav-btn[data-view="'+x+'"]').classList.toggle('active',x===v);
  });
  $('pageTitle').textContent=v==='tasks'?'Tarefas':'Agenda';
}
async function renderCalendar(){
  const events=await load(EVENTS_KEY), y=currentMonth.getFullYear(),m=currentMonth.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0);
  $('monthLabel').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(currentMonth);
  const start=new Date(y,m,1),end=new Date(y,m+1,0,23,59,59),all=events.flatMap(e=>occurrences(e,start,end));
  const cells=Math.ceil((first.getDay()+last.getDate())/7)*7; let html='';
  for(let i=0;i<cells;i++){
    const d=new Date(y,m,i-first.getDay()+1),dayIso=iso(d),items=all.filter(e=>e.occurrenceDate===dayIso).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const pills=items.slice(0,3).map(e=>'<span class="calendar-event" data-event-id="'+e.id+'"><strong>'+esc(e.time)+'</strong> '+esc(e.title)+(e.googleEventId?' ☁':'')+(e.recurrence&&e.recurrence!=='none'?' ↻':'')+'</span>').join('');
    html+='<button class="calendar-day '+(d.getMonth()===m?'':'outside-month')+' '+(dayIso===iso()?'today':'')+'" data-date="'+dayIso+'"><span class="day-number">'+d.getDate()+'</span><span class="day-events">'+pills+(items.length>3?'<span class="more-events">+'+(items.length-3)+' mais</span>':'')+'</span></button>';
  }
  $('calendarGrid').innerHTML=html;
  document.querySelectorAll('.calendar-day').forEach(day=>day.onclick=ev=>{const pill=ev.target.closest('.calendar-event');pill?openEvent(pill.dataset.eventId):newEvent(day.dataset.date);});
}
async function renderList(){
  const events=await load(EVENTS_KEY),term=$('searchInput').value.toLowerCase(),period=$('filterPeriod').value,now=new Date();
  let items=events.flatMap(e=>occurrences(e,new Date(now.getFullYear()-2,0,1),new Date(now.getFullYear()+2,11,31,23,59,59),600));
  items=items.filter(e=>(e.title+' '+(e.category||'')+' '+(e.notes||'')).toLowerCase().includes(term));
  items=items.filter(e=>{const x=new Date(e.occurrenceDate+'T'+(e.time||'00:00'));if(period==='today')return e.occurrenceDate===iso();if(period==='upcoming')return x>=now;if(period==='past')return x<now;return true;});
  items.sort((a,b)=>new Date(a.occurrenceDate+'T'+a.time)-new Date(b.occurrenceDate+'T'+b.time));
  $('agendaList').innerHTML=items.length?items.slice(0,250).map(e=>'<article class="event-card" data-id="'+e.id+'"><div class="event-top"><div><h3>'+esc(e.title)+'</h3><div class="event-meta"><span>'+fmt(e.occurrenceDate)+'</span><span>'+esc(e.time)+'</span>'+(e.recurrence&&e.recurrence!=='none'?'<span>↻ '+recurLabel(e.recurrence)+'</span>':'')+'</div></div><span class="category '+(e.googleEventId?'google-badge':'')+'">'+esc(e.category||'Pessoal')+(e.googleEventId?' • Google':'')+'</span></div>'+(e.notes?'<p class="notes">'+esc(e.notes)+'</p>':'')+'</article>').join(''):'<div class="empty-state">Nenhum compromisso encontrado.</div>';
  document.querySelectorAll('#agendaList .event-card').forEach(x=>x.onclick=()=>openEvent(x.dataset.id));
}
async function renderTasks(){
  const tasks=await load(TASKS_KEY),term=$('taskSearchInput').value.toLowerCase(),filter=$('taskFilter').value;
  let items=tasks.filter(t=>(t.title+' '+(t.category||'')+' '+(t.notes||'')).toLowerCase().includes(term));
  if(filter==='open')items=items.filter(t=>!t.completed);if(filter==='completed')items=items.filter(t=>t.completed);if(filter==='today')items=items.filter(t=>!t.completed&&t.date===iso());
  items.sort((a,b)=>(a.completed-b.completed)||((a.date||'9999').localeCompare(b.date||'9999')));
  $('tasksList').innerHTML=items.length?items.map(t=>'<article class="task-card '+(t.completed?'completed':'')+'"><input class="task-check" type="checkbox" data-check="'+t.id+'" '+(t.completed?'checked':'')+'><button class="task-main" data-edit="'+t.id+'"><h3>'+esc(t.title)+'</h3><div class="event-meta"><span>'+(t.date?fmt(t.date):'Sem prazo')+'</span><span>'+esc(t.category||'Pessoal')+'</span></div>'+(t.notes?'<p class="notes">'+esc(t.notes)+'</p>':'')+'</button></article>').join(''):'<div class="empty-state">Nenhuma tarefa encontrada.</div>';
  document.querySelectorAll('[data-check]').forEach(x=>x.onchange=async()=>{const arr=await load(TASKS_KEY),t=arr.find(v=>v.id===x.dataset.check);if(t){t.completed=x.checked;t.completedAt=x.checked?new Date().toISOString():null;await save(TASKS_KEY,arr);await renderTasks();await stats();}});
  document.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>openTask(x.dataset.edit));
}
async function renderAll(){await Promise.all([renderCalendar(),renderList(),renderTasks(),stats()]);}

function resetEvent(date=iso()){eventForm.reset();$('eventId').value='';$('eventDate').value=date;$('eventReminder').value='10';$('eventRecurrence').value='none';$('dialogTitle').textContent='Novo compromisso';$('deleteEventBtn').classList.add('hidden');}
function newEvent(date){resetEvent(date);eventDialog.showModal();}
async function openEvent(id){const e=(await load(EVENTS_KEY)).find(x=>x.id===id);if(!e)return;$('eventId').value=e.id;$('eventTitle').value=e.title;$('eventDate').value=e.date;$('eventTime').value=e.time;$('eventCategory').value=e.category||'Pessoal';$('eventReminder').value=String(e.reminderMinutes??-1);$('eventRecurrence').value=e.recurrence||'none';$('eventRepeatUntil').value=e.repeatUntil||'';$('eventNotes').value=e.notes||'';$('dialogTitle').textContent='Editar compromisso';$('deleteEventBtn').classList.remove('hidden');eventDialog.showModal();}
function newTask(date=iso()){taskForm.reset();$('taskId').value='';$('taskDate').value=date;$('taskDialogTitle').textContent='Nova tarefa';$('deleteTaskBtn').classList.add('hidden');taskDialog.showModal();}
async function openTask(id){const t=(await load(TASKS_KEY)).find(x=>x.id===id);if(!t)return;$('taskId').value=t.id;$('taskTitle').value=t.title;$('taskDate').value=t.date||'';$('taskCategory').value=t.category||'Pessoal';$('taskNotes').value=t.notes||'';$('taskDialogTitle').textContent='Editar tarefa';$('deleteTaskBtn').classList.remove('hidden');taskDialog.showModal();}

async function refreshGoogleStatus(message){
  if(!GoogleCalendar.isConfigured()){$('googleStatusText').textContent='Falta configurar o OAuth Client ID no manifest.json.';$('googleConnectBtn').disabled=true;$('googleConnectBtn').textContent='OAuth não configurado';return;}
  const connected=await GoogleCalendar.isConnected();
  $('googleConnectBtn').classList.toggle('hidden',connected);$('googleSyncBtn').classList.toggle('hidden',!connected);$('googleDisconnectBtn').classList.toggle('hidden',!connected);
  $('googleStatusText').textContent=message||(connected?'Conectado ao calendário principal.':'Não conectado. Clique para autorizar.');
}
async function syncGoogle(){
  try{$('googleStatusText').textContent='Sincronizando...';const synced=await GoogleCalendar.syncLocalEvents(await load(EVENTS_KEY));await save(EVENTS_KEY,synced);await renderAll();await refreshGoogleStatus('Sincronização concluída às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));}
  catch(e){console.error(e);$('googleStatusText').textContent='Erro ao sincronizar: '+e.message;}
}
async function remoteSave(e){
  if(!GoogleCalendar.isConfigured()||!(await GoogleCalendar.isConnected()))return e;
  try{const r=e.googleEventId?await GoogleCalendar.updateEvent(e):await GoogleCalendar.createEvent(e);return Object.assign({},e,{googleEventId:r.id,googleHtmlLink:r.htmlLink||null,googleUpdatedAt:r.updated||null,source:e.source==='google'?'google':'local'});}
  catch(err){$('googleStatusText').textContent='Salvo localmente. Falha no Google: '+err.message;return e;}
}

$('newEventBtn').onclick=()=>newEvent();$('newTaskBtn').onclick=()=>newTask();
$('closeDialogBtn').onclick=$('cancelBtn').onclick=()=>eventDialog.close();
$('closeTaskDialogBtn').onclick=$('cancelTaskBtn').onclick=()=>taskDialog.close();
['calendar','list','tasks'].forEach(v=>{$(v+'ViewBtn').onclick=()=>switchView(v);document.querySelector('.side-nav-btn[data-view="'+v+'"]').onclick=()=>switchView(v);});
$('searchInput').oninput=renderList;$('filterPeriod').onchange=renderList;$('taskSearchInput').oninput=renderTasks;$('taskFilter').onchange=renderTasks;
$('prevMonthBtn').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();};
$('nextMonthBtn').onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();};
$('todayBtn').onclick=()=>{const n=new Date();currentMonth=new Date(n.getFullYear(),n.getMonth(),1);renderCalendar();};

eventForm.onsubmit=async ev=>{
  ev.preventDefault();const arr=await load(EVENTS_KEY),id=$('eventId').value,i=arr.findIndex(x=>x.id===id),old=i>=0?arr[i]:{};
  let e=Object.assign({},old,{id:id||crypto.randomUUID(),title:$('eventTitle').value.trim(),date:$('eventDate').value,time:$('eventTime').value,category:$('eventCategory').value,reminderMinutes:Number($('eventReminder').value),recurrence:$('eventRecurrence').value,repeatUntil:$('eventRepeatUntil').value||null,notes:$('eventNotes').value.trim(),updatedAt:new Date().toISOString(),createdAt:old.createdAt||new Date().toISOString()});
  if(!e.title)return;e=await remoteSave(e);i>=0?arr[i]=e:arr.push(e);await save(EVENTS_KEY,arr);eventDialog.close();await renderAll();
};
$('deleteEventBtn').onclick=async()=>{
  const id=$('eventId').value,arr=await load(EVENTS_KEY),e=arr.find(x=>x.id===id);if(!e||!confirm('Excluir este compromisso?'))return;
  if(e.googleEventId&&GoogleCalendar.isConfigured()&&await GoogleCalendar.isConnected()){try{await GoogleCalendar.deleteEvent(e.googleEventId);}catch(err){if(!confirm('Falha ao excluir do Google. Excluir somente localmente?'))return;}}
  await save(EVENTS_KEY,arr.filter(x=>x.id!==id));eventDialog.close();await renderAll();
};
taskForm.onsubmit=async ev=>{
  ev.preventDefault();const arr=await load(TASKS_KEY),id=$('taskId').value,i=arr.findIndex(x=>x.id===id),old=i>=0?arr[i]:{},t=Object.assign({},old,{id:id||crypto.randomUUID(),title:$('taskTitle').value.trim(),date:$('taskDate').value||null,category:$('taskCategory').value,notes:$('taskNotes').value.trim(),completed:old.completed||false,updatedAt:new Date().toISOString(),createdAt:old.createdAt||new Date().toISOString()});if(!t.title)return;i>=0?arr[i]=t:arr.push(t);await save(TASKS_KEY,arr);taskDialog.close();await renderTasks();await stats();
};
$('deleteTaskBtn').onclick=async()=>{const id=$('taskId').value;if(!id||!confirm('Excluir esta tarefa?'))return;await save(TASKS_KEY,(await load(TASKS_KEY)).filter(x=>x.id!==id));taskDialog.close();await renderTasks();await stats();};

$('googleConnectBtn').onclick=async()=>{try{$('googleStatusText').textContent='Abrindo autorização...';await GoogleCalendar.connect();await syncGoogle();}catch(e){$('googleStatusText').textContent='Não foi possível conectar: '+e.message;}};
$('googleSyncBtn').onclick=syncGoogle;
$('googleDisconnectBtn').onclick=async()=>{await GoogleCalendar.disconnect();await refreshGoogleStatus('Conta Google desconectada.');};

renderAll();refreshGoogleStatus();