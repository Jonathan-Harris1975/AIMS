() => {
  const refs = new Map()
  const conflicts = new Set()
  const setupRef = (href) => {
    const match = (href || '').match(/title-setup\/(paperback|kindle|hardcover)\/([A-Z0-9]{10,14})(?:\/|$)/i)
    return match ? { format: match[1].toLowerCase(), titleId: match[2].toUpperCase() } : null
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    const ref = setupRef(anchor.getAttribute('href'))
    if (!ref) continue
    const key = `${ref.titleId}:${ref.format}`
    const row = anchor.closest('tr[id]')
    // Row IDs group editions; only the edit link supplies a setup title ID.
    // Associate a retail link only inside an unambiguous single-format row.
    if (row) {
      const rowRefs = new Set()
      const asins = new Set()
      for (const link of row.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href') || ''
        const linkedRef = setupRef(href)
        if (linkedRef) rowRefs.add(`${linkedRef.titleId}:${linkedRef.format}`)
        const asin = href.match(/^\/amazon-dp-action\/[a-z]+\/dualbookshelf\.marketplacelink\/(B0[A-Z0-9]{8})(?:[/?#]|$)/i)?.[1]
        if (asin) asins.add(asin.toUpperCase())
      }
      if (rowRefs.size === 1 && rowRefs.has(key) && asins.size === 1) ref.asin = [...asins][0]
      if (asins.size > 1 && rowRefs.size === 1) conflicts.add(key)
    }
    const existing = refs.get(key)
    if (existing?.asin && ref.asin && existing.asin !== ref.asin) conflicts.add(key)
    refs.set(key, { ...existing, ...ref })
  }

  const verifiedRefs = [...refs.entries()].map(([key, ref]) => conflicts.has(key) ? { ...ref, asin: undefined, asinConflict: true } : ref)
  return {
    bookshelfRows: document.querySelectorAll('#bookshelftable tbody tr, table tbody tr').length,
    titleIds: [...new Set(verifiedRefs.map((ref) => ref.titleId))],
    refs: verifiedRefs,
  }
}
