const LOCAL_STATE = (process.env.SHIPPING_LOCAL_STATE || 'Chihuahua').trim().toLowerCase();
const LOCAL_COST    = Number(process.env.SHIPPING_LOCAL    || 150);
const NATIONAL_COST = Number(process.env.SHIPPING_NATIONAL || 200);

function normalize(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function quoteShipping(state) {
  const ns = normalize(state);
  if (!ns) return { cost: NATIONAL_COST, eta: '3-7 dias habiles', zone: 'nacional' };
  if (ns === normalize(LOCAL_STATE) || ns.includes('chihuahua')) {
    return { cost: LOCAL_COST, eta: '1-3 dias habiles', zone: 'local' };
  }
  return { cost: NATIONAL_COST, eta: '3-7 dias habiles', zone: 'nacional' };
}

const MEXICAN_STATES = [
  'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
  'Chihuahua','Ciudad de Mexico','Coahuila','Colima','Durango','Estado de Mexico',
  'Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacan','Morelos','Nayarit',
  'Nuevo Leon','Oaxaca','Puebla','Queretaro','Quintana Roo','San Luis Potosi',
  'Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatan','Zacatecas'
];

module.exports = { quoteShipping, MEXICAN_STATES, LOCAL_COST, NATIONAL_COST, LOCAL_STATE };
