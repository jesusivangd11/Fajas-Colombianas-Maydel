const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

function parseExp(row) {
  return {
    id:        row.id,
    concept:   row.concept,
    amount:    Number(row.amount),
    category:  row.category,
    date:      row.date?.toISOString?.().slice(0,10) || row.date,
    notes:     row.notes || '',
    createdAt: row.created_at,
  };
}

// GET /api/expenses
router.get('/', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
    res.json(rows.map(parseExp));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener gastos' });
  }
});

// GET /api/expenses/stats
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses');
    res.json({ total: Number(rows[0].total), count: Number(rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas de gastos' });
  }
});

// POST /api/expenses
router.post('/', adminOnly, async (req, res) => {
  try {
    const { concept, amount, category, date, notes } = req.body;
    if (!concept || !amount) return res.status(400).json({ error: 'Concepto y monto requeridos' });

    const id = 'EXP-' + Date.now();
    const expDate = date || new Date().toISOString().slice(0, 10);
    await pool.execute(
      'INSERT INTO expenses (id, concept, amount, category, date, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [id, concept.trim(), Number(amount), category || 'otro', expDate, notes || '']
    );
    const [rows] = await pool.execute('SELECT * FROM expenses WHERE id = ?', [id]);
    res.status(201).json(parseExp(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar gasto' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar gasto' });
  }
});

module.exports = router;
