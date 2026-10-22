// Cliente de Stripe compartido. null si no hay clave configurada.
const SECRET = process.env.STRIPE_SECRET_KEY || '';

module.exports = SECRET && !SECRET.includes('PEGA_AQUI') ? require('stripe')(SECRET) : null;
