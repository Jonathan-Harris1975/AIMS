import ExcelJS from 'exceljs'

function rowsFromSheet(sheet): unknown[][] {
  const rows: unknown[][] = []
  sheet.eachRow({ includeEmpty: true }, (row) => rows.push(row.values.slice(1)))
  return rows
}

function headerRowIndex(rows: unknown[][]): number {
  return rows.findIndex((row) => row.some((cell) => {
    const text = cell && typeof cell === 'object' && 'text' in cell ? cell.text : cell
    return String(text ?? '').trim().toLowerCase() === 'title'
  }))
}

/** Merge KDP monthly .xlsx exports into one workbook, appending each sheet's data rows. */
export async function mergeWorkbookBuffers(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('No workbooks to merge.')
  if (buffers.length === 1) return buffers[0]!

  const merged = new ExcelJS.Workbook()
  await merged.xlsx.load(buffers[0])

  for (let i = 1; i < buffers.length; i += 1) {
    const incoming = new ExcelJS.Workbook()
    await incoming.xlsx.load(buffers[i])

    for (const source of incoming.worksheets) {
      const incomingRows = rowsFromSheet(source)
      if (incomingRows.length === 0) continue

      const destination = merged.getWorksheet(source.name)
      if (!destination) {
        const created = merged.addWorksheet(source.name)
        for (const row of incomingRows) created.addRow(row)
        continue
      }

      const incomingHeaderIdx = headerRowIndex(incomingRows)
      const dataStart = incomingHeaderIdx >= 0 ? incomingHeaderIdx + 1 : Math.min(2, incomingRows.length)
      for (const row of incomingRows.slice(dataStart)) destination.addRow(row)
    }
  }

  return Buffer.from(await merged.xlsx.writeBuffer())
}
