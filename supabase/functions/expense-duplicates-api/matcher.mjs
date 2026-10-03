const clean = value => String(value || '').normalize('NFKC').replace(/[\s　・.,，．]/g,'').toLowerCase()
const dateGap = (a,b) => Math.abs((Date.parse(`${a}T00:00:00Z`)-Date.parse(`${b}T00:00:00Z`))/86400000)
export function matches(expenses,invoices,receipts,month=null) {
  const candidates=[]
  const index=rows=>{
    const groups=new Map()
    for(const row of rows){const key=`${Number(row.amount)}:${clean(row.vendor)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
    return groups
  }
  const invoiceIndex=index(invoices),receiptIndex=index(receipts)
  const group=(lookup,row)=>lookup.get(`${Number(row.amount)}:${clean(row.vendor)}`)||[]
  const compare=(left,right,kind) => {
    if(!left.date||!right.date||!Number(left.amount)||Number(left.amount)!==Number(right.amount))return
    if(!clean(left.vendor)||clean(left.vendor)!==clean(right.vendor))return
    const days=dateGap(left.date,right.date)
    if(!Number.isFinite(days)||days>31)return
    if(month&&!left.date.startsWith(month)&&!right.date.startsWith(month))return
    candidates.push({kind,left:{id:left.id,date:left.date,vendor:left.vendor,amount:Number(left.amount)},right:{id:right.id,date:right.date,vendor:right.vendor,amount:Number(right.amount)},days})
  }
  for(const expense of expenses){
    for(const invoice of group(invoiceIndex,expense))compare(expense,invoice,'expense_invoice')
    for(const receipt of group(receiptIndex,expense))if(expense.receipt_import_id!==receipt.id)compare(expense,receipt,'expense_receipt')
  }
  for(const invoice of invoices)for(const receipt of group(receiptIndex,invoice))compare(invoice,receipt,'invoice_receipt')
  candidates.sort((a,b)=>a.days-b.days||a.kind.localeCompare(b.kind)||a.left.id-b.left.id)
  return {candidates:candidates.slice(0,100),limited:candidates.length>100,total:candidates.length}
}
