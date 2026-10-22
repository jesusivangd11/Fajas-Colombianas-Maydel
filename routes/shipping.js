const router = require('express').Router();
const { quoteShipping, stateFromCP, MEXICAN_STATES, LOCAL_COST, NATIONAL_COST, LOCAL_STATE } = require('../services/shipping');

router.get('/quote', (req, res) => {
  const state = req.query.state || '';
  res.json(quoteShipping(state));
});

// GET /api/shipping/cp/:cp  -> { state } del código postal (para autollenar el estado)
router.get('/cp/:cp', (req, res) => {
  const state = stateFromCP(req.params.cp);
  if (!state) return res.status(404).json({ error: 'Código postal no válido' });
  res.json({ state });
});

router.get('/options', (req, res) => {
  res.json({
    states: MEXICAN_STATES,
    rates: {
      local:    { state: LOCAL_STATE, cost: LOCAL_COST,    eta: '1-3 dias habiles' },
      national: { cost: NATIONAL_COST, eta: '3-7 dias habiles' },
    },
  });
});

module.exports = router;
