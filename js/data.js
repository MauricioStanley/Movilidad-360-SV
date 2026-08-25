/* =========================================================================
   MOVILIDAD 360 SV — data.js
   Toda la información editable del sitio vive aquí. No hay backend: este
   archivo es la "base de datos" del proyecto mientras se aloja en GitHub
   Pages. Los precios son estimados/inventados a propósito (el cliente
   indicó que se reemplazarán por tarifas reales más adelante).
   ========================================================================= */

const CONFIG = {
  // ⚠️ REEMPLAZAR: número de WhatsApp del CEO en formato internacional,
  // SIN "+" y sin espacios. Ejemplo El Salvador: "503" + 8 dígitos.
  whatsappNumber: "50375031132",
  brand: "MOVILIDAD 360 SV",
  slogan: "Tu destino está más cerca de lo que te imaginas",
  // Punto de referencia por defecto: Plaza Las Américas (El Salvador del Mundo),
  // usado como origen cuando el usuario no comparte su ubicación.
  originFallback: { name: "San Salvador (Centro)", lat: 13.6989, lng: -89.1914 },
  pricing: {
    local:      { base: 2.5, perKm: 0.65, min: 3.0 },   // viajes dentro del área metropolitana
    airport:    { base: 8.0, perKm: 0.55, min: 12.0 },  // traslados a aeropuerto
    department: { base: 6.0, perKm: 0.42, min: 10.0 },  // viajes interdepartamentales
    tourism:    { base: 10.0, perKm: 0.48, min: 15.0 }, // viajes a destinos turísticos
    parcel: {
      small:  4.0,   // documentos, paquetes pequeños (<2kg)
      medium: 7.0,   // caja mediana (2-8kg)
      large:  12.0,  // caja grande / voluminoso (8-20kg)
      perKmExtra: 0.30,
      urgentSurcharge: 5.0, // recargo por entrega el mismo día / express
    },
  },
  avgSpeedKmh: {
    city: 28,     // tráfico urbano, San Salvador y alrededores
    highway: 62,  // carretera / interdepartamental
  },
};

/* ---------- Aeropuertos ---------- */
const AIRPORTS = [
  {
    id: "aila",
    name: "Aeropuerto Internacional El Salvador (AILA)",
    short: "San Óscar A. Romero y Galdámez",
    lat: 13.4409, lng: -89.0557,
    type: "Internacional",
  },
  {
    id: "ilopango",
    name: "Aeropuerto de Ilopango",
    short: "Vuelos nacionales y chárter",
    lat: 13.6997, lng: -89.1197,
    type: "Nacional / chárter",
  },
];

/* ---------- Departamentos de El Salvador ---------- */
const DEPARTMENTS = [
  { name: "La Libertad",    lat: 13.6769, lng: -89.2797, popular: true,  tag: "Playas y Ruta de las Flores" },
  { name: "Santa Ana",      lat: 13.9942, lng: -89.5597, popular: true,  tag: "Volcán y Lago de Coatepeque" },
  { name: "Sonsonate",      lat: 13.7186, lng: -89.7241, popular: true,  tag: "Ruta de las Flores y costa" },
  { name: "Ahuachapán",     lat: 13.9214, lng: -89.8450, popular: true,  tag: "Concepción de Ataco" },
  { name: "Usulután",       lat: 13.3500, lng: -88.4500, popular: true,  tag: "Laguna de Alegría" },
  { name: "La Unión",       lat: 13.3369, lng: -87.8444, popular: true,  tag: "Golfo de Fonseca" },
  { name: "San Salvador",   lat: 13.6929, lng: -89.2182, popular: false, tag: "Capital" },
  { name: "La Paz",         lat: 13.5083, lng: -88.8664, popular: false, tag: "Costa del Sol" },
  { name: "Cuscatlán",      lat: 13.7167, lng: -88.9333, popular: false, tag: "Suchitoto" },
  { name: "San Vicente",    lat: 13.6411, lng: -88.7856, popular: false, tag: "Volcán Chinchontepec" },
  { name: "Cabañas",        lat: 13.8747, lng: -88.6333, popular: false, tag: "Zona oriental" },
  { name: "San Miguel",     lat: 13.4833, lng: -88.1833, popular: false, tag: "Zona oriental" },
  { name: "Morazán",        lat: 13.7008, lng: -88.1075, popular: false, tag: "Perquín" },
  { name: "Chalatenango",   lat: 14.0333, lng: -88.9333, popular: false, tag: "Zona norte" },
];

/* ---------- Lugares populares para viajes locales (área metropolitana) ---------- */
const LOCAL_PLACES = [
  { name: "Metrocentro San Salvador", lat: 13.7008, lng: -89.2064 },
  { name: "Multiplaza",               lat: 13.6725, lng: -89.2508 },
  { name: "Plaza Merliot",            lat: 13.6764, lng: -89.2611 },
  { name: "La Gran Vía",              lat: 13.6650, lng: -89.2489 },
  { name: "Centro Histórico SS",      lat: 13.6989, lng: -89.1914 },
  { name: "Zona Rosa",                lat: 13.6942, lng: -89.2358 },
  { name: "San Benito",               lat: 13.6975, lng: -89.2364 },
  { name: "UCA",                      lat: 13.6819, lng: -89.2364 },
  { name: "Universidad de El Salvador", lat: 13.7186, lng: -89.2044 },
  { name: "Hospital Nacional Rosales", lat: 13.7008, lng: -89.2019 },
  { name: "Terminal de Occidente",    lat: 13.6944, lng: -89.2181 },
  { name: "Terminal de Oriente",      lat: 13.7053, lng: -89.1717 },
  { name: "Plaza Futura",             lat: 13.6764, lng: -89.2394 },
  { name: "Galerías Escalón",         lat: 13.6975, lng: -89.2439 },
];

/* ---------- Mejores lugares turísticos de El Salvador ---------- */
const TOURIST_PLACES = [
  { name: "El Tunco", dept: "La Libertad", category: "Playa", lat: 13.4903, lng: -89.3811,
    desc: "La playa surfista más icónica del país, con ambiente vibrante al atardecer." },
  { name: "El Zonte", dept: "La Libertad", category: "Playa", lat: 13.4956, lng: -89.4083,
    desc: "Conocida como 'Surf City', cuna de la economía Bitcoin en El Salvador." },
  { name: "Suchitoto", dept: "Cuscatlán", category: "Pueblo colonial", lat: 13.9383, lng: -89.0286,
    desc: "Calles de piedra, arte y vistas al Lago Suchitlán." },
  { name: "Juayúa", dept: "Sonsonate", category: "Ruta de las Flores", lat: 13.8358, lng: -89.7514,
    desc: "Famosa por su feria gastronómica de fin de semana." },
  { name: "Concepción de Ataco", dept: "Ahuachapán", category: "Ruta de las Flores", lat: 13.8722, lng: -89.8500,
    desc: "Casas coloridas, murales y café de altura." },
  { name: "Apaneca", dept: "Ahuachapán", category: "Ruta de las Flores", lat: 13.8514, lng: -89.7994,
    desc: "El pueblo más alto de El Salvador, rodeado de fincas de café." },
  { name: "Volcán de Santa Ana", dept: "Santa Ana", category: "Volcán", lat: 13.8536, lng: -89.6297,
    desc: "El volcán más alto del país, con una laguna turquesa en el cráter." },
  { name: "Lago de Coatepeque", dept: "Santa Ana", category: "Lago", lat: 13.8600, lng: -89.5450,
    desc: "Un lago cráter de aguas azul-turquesa, ideal para descansar." },
  { name: "Joya de Cerén", dept: "La Libertad", category: "Sitio arqueológico", lat: 13.8228, lng: -89.3608,
    desc: "Patrimonio de la Humanidad UNESCO, la 'Pompeya de América'." },
  { name: "Ruinas de San Andrés", dept: "La Libertad", category: "Sitio arqueológico", lat: 13.8103, lng: -89.4058,
    desc: "Antiguo centro ceremonial maya en el Valle de Zapotitán." },
  { name: "Perquín", dept: "Morazán", category: "Montaña", lat: 13.9581, lng: -88.1758,
    desc: "Clima fresco, historia y senderos en la Ruta de Paz." },
  { name: "Laguna de Alegría", dept: "Usulután", category: "Laguna", lat: 13.5039, lng: -88.4936,
    desc: "Una laguna de cráter de aguas sulfurosas color esmeralda." },
  { name: "Volcán de Izalco", dept: "Sonsonate", category: "Volcán", lat: 13.8144, lng: -89.6331,
    desc: "El 'Faro del Pacífico', uno de los volcanes más jóvenes de América." },
  { name: "Playa Los Cóbanos", dept: "Sonsonate", category: "Playa", lat: 13.5228, lng: -89.8347,
    desc: "El único arrecife de coral vivo del país, ideal para snorkel." },
  { name: "Bahía de Jiquilisco", dept: "Usulután", category: "Naturaleza", lat: 13.2333, lng: -88.5333,
    desc: "Manglares y playas vírgenes, reserva de la biósfera." },
  { name: "Cerro Verde", dept: "Santa Ana", category: "Montaña", lat: 13.8419, lng: -89.6314,
    desc: "Miradores con vista a los volcanes Izalco y Santa Ana." },
  { name: "Centro Histórico de San Salvador", dept: "San Salvador", category: "Ciudad", lat: 13.6989, lng: -89.1914,
    desc: "Catedral Metropolitana, Palacio Nacional y Teatro Nacional." },
  { name: "Golfo de Fonseca", dept: "La Unión", category: "Playa", lat: 13.2028, lng: -87.8083,
    desc: "Islas, manglares y playas tranquilas en el oriente del país." },
];