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
  // Tarifa única: precio estimado = distancia real de la ruta (km) x ratePerKm.
  // Es un estimado; el precio final se confirma por WhatsApp.
  ratePerKm: 0.55,
  // ⚠️ REEMPLAZAR con el número real de viajes completados.
  tripsCompleted: 500,
  responseMinutes: 5,
  // ⚠️ REEMPLAZAR: pega aquí el enlace a tu perfil de Google Business
  // (ej. "https://g.page/r/....") cuando lo tengas. Mientras esté vacío
  // ("") el botón de reseñas de Google no se muestra en el sitio.
  googleReviewsUrl: "",
  // Métodos de pago que se ofrecen al cliente al cotizar.
  paymentMethods: ["Efectivo", "Transferencia"],
  // Política de cancelación: si el viaje cuesta más de freeThresholdUsd,
  // se cobra feePercent% por cancelar; si cuesta igual o menos, es gratis.
  cancellation: { freeThresholdUsd: 10, feePercent: 15 },
  pricing: {
    parcel: {
      small:  4.0,   // documentos, paquetes pequeños (<2kg)
      medium: 7.0,   // caja mediana (2-8kg)
      large:  12.0,  // caja grande / voluminoso (8-20kg)
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

/* ---------- Testimonios ----------
   ⚠️ REEMPLAZAR: estos son testimonios de ejemplo. Antes de publicar,
   cambia el nombre y el texto por testimonios reales de tus clientes. */
const TESTIMONIALS = [
  {
    name: "[Reemplazar: nombre del cliente]",
    service: "Viaje local",
    quote: "[Reemplazar: escribe aquí un testimonio real de un cliente satisfecho con el servicio de viaje local.]",
  },
  {
    name: "[Reemplazar: nombre del cliente]",
    service: "Traslado al aeropuerto",
    quote: "[Reemplazar: escribe aquí un testimonio real sobre un traslado al aeropuerto.]",
  },
  {
    name: "[Reemplazar: nombre del cliente]",
    service: "Turismo",
    quote: "[Reemplazar: escribe aquí un testimonio real de un viaje turístico con Movilidad 360 SV.]",
  },
];

/* ---------- Vehículos disponibles ----------
   Ilustrativo: el cliente no elige el vehículo específico, solo el tipo
   que probablemente lo recogerá. Se le enviará el vehículo que esté
   disponible en el momento del viaje, y su foto se confirma por WhatsApp
   antes de recogerlo.
   ⚠️ REEMPLAZAR: cuando tengan fotos reales de los vehículos, agreguen
   un campo "photo": "ruta/a/la/foto.jpg" (una sola foto) o "photos": [...]
   (varias fotos que rotan en la tarjeta) — se usan automáticamente en vez
   del ícono. */
const VEHICLES = [
  {
    type: "Sedán",
    capacity: "Hasta 4 pasajeros",
    desc: "Ideal para viajes locales y traslados individuales o en pareja. Te enviamos el sedán disponible en el momento.",
    icon: "sedan",
    photos: ["img/vehicles/sedan-1.jpg", "img/vehicles/sedan-2.jpg", "img/vehicles/sedan-3.jpg"],
  },
  {
    type: "Camioneta",
    capacity: "Hasta 6 pasajeros",
    desc: "Más espacio para equipaje, grupos familiares o viajes al aeropuerto.",
    icon: "suv",
    photo: null,
  },
  {
    type: "Microbús",
    capacity: "Hasta 12 pasajeros",
    desc: "Perfecta para grupos grandes, tours y viajes interdepartamentales.",
    icon: "van",
    photo: null,
  },
  {
    type: "Pick up",
    capacity: "Mudanzas y carga",
    desc: "Para mudanzas pequeñas, muebles y carga voluminosa.",
    icon: "pickup",
    photo: "img/vehicles/pickup-1.jpg",
  },
];

/* ---------- Tarifas fijas ----------
   Precios ya negociados por el cliente para un punto de origen fijo.
   No usan geolocalización ni distancia calculada: el precio es el mismo
   siempre que se salga desde "origin". Si algún destino es negociable
   (el precio puede variar), márcalo con "negotiable: true". */
const FIXED_ROUTES = {
  origin: "Assistenza Italiana, Antiguo Cuscatlán",
  destinations: [
    { name: "Hospital El Salvador", price: 4 },
    { name: "Hospital de la Mujer", price: 7 },
    { name: "Hospital Militar", price: 10 },
    { name: "Hospital de Diagnóstico", price: 7 },
    { name: "Hospital San Rafael", price: 7 },
    { name: "Hospital Ilamatepec", price: 10 },
    { name: "Hospital Zacamil", price: 15 },
    { name: "Aeropuerto Internacional", price: 40 },
    { name: "Aeropuerto de Ilopango", price: 20 },
    { name: "Hotel Intercontinental", price: 8 },
    { name: "Hotel Holiday Inn", price: 7 },
    { name: "Hotel Hilton Escalón", price: 7 },
    { name: "Terminal del Sur", price: 15 },
    { name: "Terminal de Occidente", price: 5 },
    { name: "Terminal Nuevo Amanecer", price: 20 },
    { name: "Terminal de Chalatenango", price: 12 },
    { name: "Terminal del Puerto La Libertad", price: 8 },
    { name: "Centro Histórico", price: 8 },
    { name: "San Jacinto", price: 8 },
    { name: "San Marcos", price: 15 },
    { name: "Santo Tomás", price: 15, negotiable: true },
    { name: "Santiago Texacuangos", price: 20 },
    { name: "Olocuilta", price: 25 },
    { name: "Santa Tecla", price: 8 },
    { name: "Mejicanos", price: 15 },
    { name: "Apopa", price: 25 },
    { name: "Soyapango", price: 25 },
    { name: "Ilopango", price: 20 },
    { name: "San Luis Talpa", price: 35 },
    { name: "San Juan Talpa", price: 30 },
  ],
};

/* ---------- Rutas turísticas sugeridas ----------
   Combinan varios destinos de TOURIST_PLACES (por nombre) en un solo
   recorrido sugerido. La distancia/tiempo/precio se calculan sumando
   cada tramo real (origen → parada 1 → parada 2 → ...). */
const TOURIST_ROUTES = [
  {
    name: "Ruta de las Flores completa",
    desc: "Un recorrido por los pueblos más coloridos de Occidente: café, murales y feria gastronómica.",
    stops: ["Juayúa", "Apaneca", "Concepción de Ataco"],
  },
  {
    name: "Volcanes y lago de Santa Ana",
    desc: "Naturaleza y miradores en un solo día: el volcán más alto del país y un lago de aguas turquesa.",
    stops: ["Cerro Verde", "Volcán de Santa Ana", "Lago de Coatepeque"],
  },
  {
    name: "Playas del Bálsamo",
    desc: "Surf, atardeceres y ambiente de playa a menos de una hora del área metropolitana.",
    stops: ["El Tunco", "El Zonte"],
  },
  {
    name: "Historia y arqueología",
    desc: "Un recorrido por el pasado maya y colonial de El Salvador.",
    stops: ["Joya de Cerén", "Ruinas de San Andrés", "Centro Histórico de San Salvador"],
  },
];

/* ---------- Preguntas frecuentes ----------
   ⚠️ Revisar/ajustar: algunas respuestas (ej. métodos de pago, seguro)
   dependen de cómo operan realmente. Edítalas para que sean 100% exactas
   antes de publicar. */
const FAQS = [
  {
    q: "¿Cómo se calcula el precio de mi viaje?",
    a: `El precio se calcula como distancia real de la ruta por carretera × $${CONFIG.ratePerKm}/km. Siempre es un estimado: el precio final se confirma por WhatsApp antes de tu viaje.`,
  },
  {
    q: "¿Qué métodos de pago aceptan?",
    a: `Aceptamos ${CONFIG.paymentMethods.join(" y ")}. Eliges el método al momento de cotizar tu viaje.`,
  },
  {
    q: "¿Puedo cancelar mi reserva?",
    a: `Sí. Si el viaje cuesta $${CONFIG.cancellation.freeThresholdUsd} o menos, puedes cancelar sin ningún cargo. Si cuesta más de $${CONFIG.cancellation.freeThresholdUsd}, la cancelación tiene un cargo del ${CONFIG.cancellation.feePercent}% del valor del viaje. Esta política se muestra siempre antes de confirmar tu reserva.`,
  },
  {
    q: "¿Los conductores hablan inglés?",
    a: "[Reemplazar: indica si tus conductores pueden atender a turistas que no hablan español.]",
  },
  {
    q: "¿El viaje tiene algún tipo de seguro?",
    a: "Nuestro compromiso es finalizar el viaje sin importar las condiciones: si ocurre un imprevisto en el camino (clima, tráfico, un desperfecto del vehículo), garantizamos que llegues a tu destino.",
  },
  {
    q: "¿Cuánto tardan en confirmar mi reserva?",
    a: `Respondemos en un tiempo estimado de ~${CONFIG.responseMinutes} minutos por WhatsApp, en horario de atención.`,
  },
  {
    q: "¿Puedo pedir un viaje para varios pasajeros o con mascota?",
    a: "Sí. Al cotizar, indica el número de pasajeros y si llevas mascota — esa información se incluye automáticamente en tu mensaje de WhatsApp para que el equipo prepare el vehículo adecuado.",
  },
  {
    q: "¿Hacen mudanzas?",
    a: "Sí, atendemos mudanzas pequeñas y medianas. Como el precio depende del volumen y las condiciones de acceso, cotizamos cada mudanza directamente por WhatsApp con los detalles que nos compartas.",
  },
];