export function restoreProfileLocation(value = {}) {
 const section = value.section
 if (section === 'time' || section === 'data' || section === 'categories') return { section: 'more', group: section }
 return {section:['goals','preferences','memories','more'].includes(section)?section:'goals',group:['time','data','categories'].includes(value.group)?value.group:null}
}
export function activeGoals(rows) { return rows.filter(row=>row.status==='active').sort((a,b)=>a.priority-b.priority) }
