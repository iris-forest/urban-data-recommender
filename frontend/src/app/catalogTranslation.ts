const PHRASE_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bAyuntamiento de Madrid\b/gi, "Madrid City Council"],
  [/\bPortal de datos abiertos\b/gi, "Open Data Portal"],
  [/\bDatos abiertos\b/gi, "Open Data"],
  [/\bComunidad de Madrid\b/gi, "Community of Madrid"],
  [/\bCalidad del aire\b/gi, "Air quality"],
  [/\bcontaminaci[oó]n atmosf[eé]rica\b/gi, "air pollution"],
  [/\bZonas de bajas emisiones\b/gi, "Low-emission zones"],
  [/\bZona de bajas emisiones\b/gi, "Low-emission zone"],
  [/\bZBE\b/g, "LEZ"],
  [/\bParques y jardines\b/gi, "Parks and gardens"],
  [/\bParques y zonas verdes\b/gi, "Parks and green areas"],
  [/\bZonas verdes urbanas\b/gi, "Urban green areas"],
  [/\bZonas verdes\b/gi, "Green areas"],
  [/\bZona verde\b/gi, "Green area"],
  [/\bSuperficie de parques\b/gi, "Park area"],
  [/\bSuperficie ocupada por parques\b/gi, "Area occupied by parks"],
  [/\bArbolado\b/gi, "Trees"],
  [/\bPoblaci[oó]n\b/gi, "Population"],
  [/\bPadr[oó]n municipal\b/gi, "Municipal register"],
  [/\bHabitantes\b/gi, "Inhabitants"],
  [/\bResidentes\b/gi, "Residents"],
  [/\bPersonas mayores\b/gi, "Older adults"],
  [/\bMayores\b/gi, "Older adults"],
  [/\bTercera edad\b/gi, "Older adults"],
  [/\bLista de espera\b/gi, "Waiting list"],
  [/\bCenso\b/gi, "Census"],
  [/\bSecciones censales\b/gi, "Census sections"],
  [/\bSecci[oó]n censal\b/gi, "Census section"],
  [/\bDistritos\b/gi, "Districts"],
  [/\bDistrito\b/gi, "District"],
  [/\bBarrios\b/gi, "Neighborhoods"],
  [/\bBarrio\b/gi, "Neighborhood"],
  [/\bL[ií]mites administrativos\b/gi, "Administrative boundaries"],
  [/\bCartograf[ií]a\b/gi, "Mapping"],
  [/\bEstaciones de metro\b/gi, "Metro stations"],
  [/\bMetro Ligero\b/gi, "Light rail"],
  [/\bCercan[ií]as\b/gi, "Commuter rail"],
  [/\bEstaciones\b/gi, "Stations"],
  [/\bTransporte p[uú]blico\b/gi, "Public transport"],
  [/\bMovilidad\b/gi, "Mobility"],
  [/\bTr[aá]fico\b/gi, "Traffic"],
  [/\bVivienda\b/gi, "Housing"],
  [/\bAlquiler\b/gi, "Rent"],
  [/\bUrbanismo\b/gi, "Urban planning"],
  [/\bUso del suelo\b/gi, "Land use"],
  [/\bUsos del suelo\b/gi, "Land uses"],
  [/\bCatastro\b/gi, "Cadastre"],
  [/\bEquipamientos\b/gi, "Facilities"],
  [/\bCentros de salud\b/gi, "Health centers"],
  [/\bCentros educativos\b/gi, "Education facilities"],
  [/\bCentros\b/gi, "Centers"],
  [/\bSalud\b/gi, "Health"],
  [/\bEducaci[oó]n\b/gi, "Education"],
  [/\bEmpleo\b/gi, "Employment"],
  [/\bRenta\b/gi, "Income"],
  [/\bVulnerabilidad\b/gi, "Vulnerability"],
  [/\bDesigualdad\b/gi, "Inequality"],
  [/\bExpedientes sancionadores\b/gi, "Enforcement cases"],
  [/\bInformaci[oó]n relativa a\b/gi, "Information about"],
  [/\bInformaci[oó]n sobre\b/gi, "Information about"],
  [/\bDatos sobre\b/gi, "Data about"],
  [/\bRelaci[oó]n de\b/gi, "List of"],
  [/\bListado de\b/gi, "List of"],
  [/\bN[uú]mero de\b/gi, "Number of"],
  [/\bTotal de\b/gi, "Total"],
  [/\bpor distrito\b/gi, "by district"],
  [/\bpor barrio\b/gi, "by neighborhood"],
  [/\bpor secci[oó]n censal\b/gi, "by census section"],
  [/\bpor municipio\b/gi, "by municipality"],
  [/\bMunicipio de Madrid\b/gi, "Municipality of Madrid"],
  [/\bMunicipios\b/gi, "Municipalities"],
  [/\bMunicipio\b/gi, "Municipality"],
  [/\bAnual\b/gi, "Annual"],
  [/\bMensual\b/gi, "Monthly"],
  [/\bSemanal\b/gi, "Weekly"],
  [/\bDiario\b/gi, "Daily"],
  [/\bDesconocido\b/gi, "Unknown"],
  [/\bsin periodicidad\b/gi, "no fixed frequency"],
  [/\bactualizaci[oó]n\b/gi, "update"],
  [/\bfecha\b/gi, "date"],
  [/\bAño\b/gi, "Year"],
  [/\bActuaciones de mejora\b/gi, "Improvement works"],
];

const WORD_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bdataset\b/gi, "dataset"],
  [/\bdatasets\b/gi, "datasets"],
  [/\bdato\b/gi, "data"],
  [/\bdatos\b/gi, "data"],
  [/\babiertos\b/gi, "open"],
  [/\babierto\b/gi, "open"],
  [/\bcallejero\b/gi, "street map"],
  [/\bcalles\b/gi, "streets"],
  [/\bcalle\b/gi, "street"],
  [/\bplazas\b/gi, "squares"],
  [/\bplaza\b/gi, "square"],
  [/\bparques\b/gi, "parks"],
  [/\bparque\b/gi, "park"],
  [/\bjardines\b/gi, "gardens"],
  [/\bjard[ií]n\b/gi, "garden"],
  [/\b[áa]reas\b/gi, "areas"],
  [/\b[áa]rea\b/gi, "area"],
  [/\bverde\b/gi, "green"],
  [/\bverdes\b/gi, "green"],
  [/\baire\b/gi, "air"],
  [/\btransporte\b/gi, "transport"],
  [/\bautob[uú]s\b/gi, "bus"],
  [/\bautobuses\b/gi, "buses"],
  [/\btren\b/gi, "train"],
  [/\bferrocarril\b/gi, "railway"],
  [/\bestaci[oó]n\b/gi, "station"],
  [/\bl[ií]nea\b/gi, "line"],
  [/\bl[ií]neas\b/gi, "lines"],
  [/\bacceso\b/gi, "access"],
  [/\baccesibilidad\b/gi, "accessibility"],
  [/\bdistancia\b/gi, "distance"],
  [/\bmetros\b/gi, "meters"],
  [/\bresidentes\b/gi, "residents"],
  [/\bresidente\b/gi, "resident"],
  [/\bmayor\b/gi, "older adult"],
  [/\bmayores\b/gi, "older adults"],
  [/\bviviendas\b/gi, "housing units"],
  [/\bvivienda\b/gi, "housing"],
  [/\bhogares\b/gi, "households"],
  [/\bhogar\b/gi, "household"],
  [/\bescuelas\b/gi, "schools"],
  [/\bcolegios\b/gi, "schools"],
  [/\bcolegio\b/gi, "school"],
  [/\bhospitales\b/gi, "hospitals"],
  [/\bhospital\b/gi, "hospital"],
  [/\by\b/gi, "and"],
  [/\baño\b/gi, "year"],
  [/\baceras\b/gi, "sidewalks"],
  [/\bacera\b/gi, "sidewalk"],
  [/\bcalzadas\b/gi, "roadways"],
  [/\bcalzada\b/gi, "roadway"],
  [/\bactuaciones\b/gi, "works"],
  [/\bactuacion\b/gi, "work"],
  [/\bactuaci[oó]n\b/gi, "work"],
  [/\bmejora\b/gi, "improvement"],
  [/\bcondiciones\b/gi, "conditions"],
  [/\bcondici[oó]n\b/gi, "condition"],
  [/\bim[aá]genes\b/gi, "images"],
  [/\bimagen\b/gi, "image"],
  [/\bexistentes\b/gi, "existing"],
  [/\bexistente\b/gi, "existing"],
  [/\brealizada\b/gi, "created"],
  [/\brealizado\b/gi, "created"],
  [/\bcontinua\b/gi, "continuous"],
  [/\bcontinuo\b/gi, "continuous"],
];

const SPANISH_SIGNAL =
  /\b(de|del|la|las|los|el|en|por|para|con|sobre|seg[uú]n|municipio|distrito|barrio|poblaci[oó]n|vivienda|calidad|parques|zonas|datos)\b/i;

export function translateCatalogText(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return raw;
  if (/^datos\.gob\.es$/i.test(raw)) return raw;
  if (!SPANISH_SIGNAL.test(raw) && !/[áéíóúñÁÉÍÓÚÑ]/.test(raw)) return raw;

  let translated = raw;
  [...PHRASE_TRANSLATIONS, ...WORD_TRANSLATIONS].forEach(([pattern, replacement]) => {
    translated = translated.replace(pattern, replacement);
  });

  return cleanupTranslatedText(translated);
}

function cleanupTranslatedText(value: string): string {
  return value
    .replace(/\bde la\b/gi, "of the")
    .replace(/\bde los\b/gi, "of the")
    .replace(/\bde las\b/gi, "of the")
    .replace(/\bdel\b/gi, "of the")
    .replace(/\bde\b/gi, "of")
    .replace(/\bla\b/gi, "the")
    .replace(/\blas\b/gi, "the")
    .replace(/\blos\b/gi, "the")
    .replace(/\bel\b/gi, "the")
    .replace(/\ben\b/gi, "in")
    .replace(/\bpor\b/gi, "by")
    .replace(/\bpara\b/gi, "for")
    .replace(/\bcon\b/gi, "with")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}
