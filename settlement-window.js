((root,factory)=>{
  if(typeof module==='object'&&module.exports)module.exports=factory()
  else root.MACHI_SETTLEMENT_WINDOW=factory()
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function shift(month,offset){
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('月を確認してください')
    const date=new Date(`${month}-01T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth()+offset)
    return date.toISOString().slice(0,7)
  }
  function summarize(month,source,statement){
    if(!source||!statement)return {month,available:false}
    const cash=source.cash_rows||[],entries=(statement.entries||[]).filter(row=>!row.voided_at&&row.channel_code==='paypay')
    return {month,available:true,closed_days:cash.length,sales:cash.reduce((sum,row)=>sum+Number(row.paypay_sales||0),0),deposit_count:entries.length,deposits:entries.reduce((sum,row)=>sum+Number(row.amount_yen||0),0)}
  }
  return {shift,summarize}
})
