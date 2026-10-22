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

// Los dos primeros dígitos del código postal mexicano indican el estado (rangos
// de SEPOMEX). Sirve para que el costo de envío no dependa solo del estado que
// elige la clienta: con un C.P. de otro estado no se cobra la tarifa local.
const CP_RANGES = [
  [1, 16, 'Ciudad de Mexico'], [20, 20, 'Aguascalientes'], [21, 22, 'Baja California'],
  [23, 23, 'Baja California Sur'], [24, 24, 'Campeche'], [25, 27, 'Coahuila'], [28, 28, 'Colima'],
  [29, 30, 'Chiapas'], [31, 33, 'Chihuahua'], [34, 35, 'Durango'], [36, 38, 'Guanajuato'],
  [39, 41, 'Guerrero'], [42, 43, 'Hidalgo'], [44, 49, 'Jalisco'], [50, 57, 'Estado de Mexico'],
  [58, 61, 'Michoacan'], [62, 62, 'Morelos'], [63, 63, 'Nayarit'], [64, 67, 'Nuevo Leon'],
  [68, 71, 'Oaxaca'], [72, 75, 'Puebla'], [76, 76, 'Queretaro'], [77, 77, 'Quintana Roo'],
  [78, 79, 'San Luis Potosi'], [80, 82, 'Sinaloa'], [83, 85, 'Sonora'], [86, 86, 'Tabasco'],
  [87, 89, 'Tamaulipas'], [90, 90, 'Tlaxcala'], [91, 96, 'Veracruz'], [97, 97, 'Yucatan'],
  [98, 99, 'Zacatecas'],
];

// '31000' -> 'Chihuahua'. null si no es un C.P. válido de 5 dígitos.
function stateFromCP(cp) {
  const d = String(cp || '').trim();
  if (!/^\d{5}$/.test(d)) return null;
  const n = Number(d.slice(0, 2));
  const hit = CP_RANGES.find(([a, b]) => n >= a && n <= b);
  return hit ? hit[2] : null;
}

// ¿El estado elegido corresponde al C.P.? (sin importar acentos ni mayúsculas)
function sameState(a, b) { return normalize(a) === normalize(b); }

module.exports = { quoteShipping, stateFromCP, sameState, MEXICAN_STATES, LOCAL_COST, NATIONAL_COST, LOCAL_STATE };
