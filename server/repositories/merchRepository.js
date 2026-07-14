// Data-access helpers for merchandise products and sales. Every function takes
// an executor so services can keep transaction ownership.

const PRODUCT_COLUMNS = `id, name, unit_cost_cents, default_price_incl_cents,
  vat_rate, quantity_on_hand, revenue_account_code, archived_at, created_at, updated_at`

const SALE_COLUMNS = `s.id, s.product_id, p.name AS product_name, s.gig_id,
  to_char(s.sale_date, 'YYYY-MM-DD') AS sale_date,
  s.quantity, s.unit_price_incl_cents, s.gross_incl_cents, s.vat_rate, s.unit_cost_cents,
  s.payment_method, s.revenue_account_code, s.status, s.voided_at, s.created_at`

export async function listProducts(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE tenant_id = $1
      ORDER BY archived_at IS NOT NULL, name ASC`,
    [tenantId],
  )
  return rows
}

export async function insertProduct(executor, tenantId, product) {
  const { rows } = await executor.query(
    `INSERT INTO products (tenant_id, name, unit_cost_cents, default_price_incl_cents, vat_rate, revenue_account_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PRODUCT_COLUMNS}`,
    [tenantId, product.name, product.unit_cost_cents, product.default_price_incl_cents, product.vat_rate, product.revenue_account_code],
  )
  return rows[0]
}

export async function updateProduct(executor, tenantId, productId, values) {
  const entries = Object.entries(values)
  const assignments = entries.map(([column], index) => `${column} = $${index + 1}`)
  assignments.push('updated_at = NOW()')
  const params = entries.map(([, value]) => value)
  params.push(productId, tenantId)
  const { rows } = await executor.query(
    `UPDATE products SET ${assignments.join(', ')}
      WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
      RETURNING ${PRODUCT_COLUMNS}`,
    params,
  )
  return rows[0] || null
}

export async function archiveProduct(executor, tenantId, productId) {
  const { rows } = await executor.query(
    `UPDATE products SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL
      RETURNING ${PRODUCT_COLUMNS}`,
    [productId, tenantId],
  )
  return rows[0] || null
}

export async function listSales(executor, tenantId, periodSql, periodValues, productId = null) {
  const params = [tenantId, ...periodValues]
  let productSql = ''
  if (productId !== null) {
    params.push(productId)
    productSql = ` AND s.product_id = $${params.length}`
  }
  const { rows } = await executor.query(
    `SELECT ${SALE_COLUMNS}
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        ${periodSql}${productSql}
      ORDER BY s.sale_date DESC, s.id DESC`,
    params,
  )
  return rows
}

export async function summarizeSales(executor, tenantId, periodSql, periodValues) {
  const { rows } = await executor.query(
    `SELECT s.product_id,
            p.name AS product_name,
            COALESCE(p.revenue_account_code, tas.merch_revenue_account_code) AS revenue_account_code,
            coa.name AS revenue_account_name,
            SUM(s.quantity)::int AS total_qty,
            SUM(COALESCE(s.gross_incl_cents, s.quantity * s.unit_price_incl_cents))::int AS total_amount_cents
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
       JOIN tenant_accounting_settings tas ON tas.tenant_id = s.tenant_id
       LEFT JOIN chart_of_accounts coa
         ON coa.tenant_id = s.tenant_id
        AND coa.code = COALESCE(p.revenue_account_code, tas.merch_revenue_account_code)
      WHERE s.tenant_id = $1
        AND s.status = 'recorded'
        ${periodSql}
      GROUP BY s.product_id, p.name,
               COALESCE(p.revenue_account_code, tas.merch_revenue_account_code), coa.name
      ORDER BY total_amount_cents DESC, p.name ASC`,
    [tenantId, ...periodValues],
  )
  return rows
}

export async function listSaleDates(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(sale_date, 'YYYY-MM-DD') AS date
       FROM merch_sales
      WHERE tenant_id = $1 AND status = 'recorded'
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((row) => row.date)
}

export async function lockProduct(executor, tenantId, productId) {
  const { rows } = await executor.query(
    'SELECT * FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [productId, tenantId],
  )
  return rows[0] || null
}

export async function insertSale(executor, tenantId, sale) {
  const { rows } = await executor.query(
    `INSERT INTO merch_sales
       (tenant_id, product_id, gig_id, sale_date, quantity,
        unit_price_incl_cents, gross_incl_cents, vat_rate, unit_cost_cents, payment_method,
        revenue_account_code, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [tenantId, sale.productId, sale.gigId, sale.saleDate, sale.quantity,
      sale.unitPriceInclCents, sale.grossInclCents, sale.vatRate, sale.unitCostCents,
      sale.paymentMethod, sale.revenueAccountCode, sale.actorUserId],
  )
  return rows[0].id
}

export async function decrementProductStock(executor, tenantId, productId, quantity) {
  await executor.query(
    `UPDATE products SET quantity_on_hand = quantity_on_hand - $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3`,
    [quantity, productId, tenantId],
  )
}

export async function lockSaleWithProduct(executor, tenantId, saleId) {
  const { rows } = await executor.query(
    `SELECT s.*, p.name AS product_name,
            p.quantity_on_hand AS product_quantity_on_hand,
            p.unit_cost_cents AS product_unit_cost_cents
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2
      FOR UPDATE OF s, p`,
    [saleId, tenantId],
  )
  return rows[0] || null
}

export async function markSaleVoided(executor, tenantId, saleId) {
  await executor.query(
    `UPDATE merch_sales SET status = 'voided', voided_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [saleId, tenantId],
  )
}

export async function setProductStock(executor, tenantId, productId, quantity, unitCostCents) {
  await executor.query(
    `UPDATE products SET quantity_on_hand = $1, unit_cost_cents = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [quantity, unitCostCents, productId, tenantId],
  )
}
