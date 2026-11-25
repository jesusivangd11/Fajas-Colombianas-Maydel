const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

// GET /api/finance/monthly?year=2025
router.get('/monthly', adminOnly, async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();

    const [revRows] = await pool.execute(
      // TiDB (only_full_group_by) exige que el SELECT use la MISMA expresión del
      // GROUP BY: "MONTH(x)-1" contra "MONTH(x)" fallaba y el panel no mostraba
      // las gráficas. Se resta 1 aquí abajo, en JS.
      `SELECT MONTH(created_at) AS m, COALESCE(SUM(total),0) AS revenue
       FROM orders
       WHERE YEAR(created_at) = ? AND status != 'cancelled' AND payment_status <> 'refunded'
         -- un pedido con tarjeta solo es venta cuando Stripe confirma el pago
         AND (payment_method <> 'stripe' OR payment_status = 'paid')
       GROUP BY MONTH(created_at)`,
      [year]
    );

    const [expRows] = await pool.execute(
      `SELECT MONTH(date) AS m, COALESCE(SUM(amount),0) AS expenses
       FROM expenses
       WHERE YEAR(date) = ?
       GROUP BY MONTH(date)`,
      [year]
    );

    const months = Array.from({ length: 12 }, (_, i) => ({ month: i, revenue: 0, expenses: 0 }));
    revRows.forEach(r => { months[r.m - 1].revenue  = Number(r.revenue); });
    expRows.forEach(r => { months[r.m - 1].expenses = Number(r.expenses); });

    res.json(months);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener datos financieros' });
  }
});

// GET /api/finance/expenses-by-category?year=2025
router.get('/expenses-by-category', adminOnly, async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const [rows] = await pool.execute(
      `SELECT category, COALESCE(SUM(amount),0) AS total
       FROM expenses WHERE YEAR(date) = ?
       GROUP BY category`,
      [year]
    );
    res.json(rows.map(r => ({ category: r.category, total: Number(r.total) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener gastos por categoría' });
  }
});

module.exports = router;
