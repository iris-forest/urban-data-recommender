"""Persistent bilingual catalog text helpers."""
from __future__ import annotations

import re
from typing import Any, Dict

from .models import Dataset


CATALOG_TRANSLATION_VERSION = "rules-v3"

PHRASE_TRANSLATIONS = (
    (r"\bAyuntamiento de Madrid\b", "Madrid City Council"),
    (r"\bPortal de datos abiertos\b", "Open Data Portal"),
    (r"\bDatos abiertos\b", "Open Data"),
    (r"\bComunidad de Madrid\b", "Community of Madrid"),
    (
        r"\bEstudio de consecuencias de la pandemia por COVID-19 en la poblaci[oó]n de la ciudad de Madrid\b",
        "Study of the consequences of the COVID-19 pandemic for Madrid residents",
    ),
    (r"\bCalidad del aire\.?\s+Estaciones de control\b", "Air quality monitoring stations"),
    (r"\bCalidad del aire\b", "Air quality"),
    (r"\bCalidad del agua regenerada\b", "Reclaimed water quality"),
    (r"\bcontaminaci[oó]n atmosf[eé]rica\b", "air pollution"),
    (r"\bZona de Bajas Emisiones de Especial Protección\b", "Special Protection Low-Emission Zone"),
    (r"\bZonas de bajas emisiones\b", "Low-emission zones"),
    (r"\bZona de bajas emisiones\b", "Low-emission zone"),
    (r"\bZBE\b", "LEZ"),
    (r"\bSuperficie de parques y zonas verdes\b", "Park and green area surface"),
    (r"\bParques y jardines\b", "Parks and gardens"),
    (r"\bParques y zonas verdes\b", "Parks and green areas"),
    (r"\bZonas verdes urbanas\b", "Urban green areas"),
    (r"\bZonas verdes\b", "Green areas"),
    (r"\bZona verde\b", "Green area"),
    (r"\bSuperficie de parques\b", "Park area"),
    (r"\bSuperficie ocupada por parques\b", "Area occupied by parks"),
    (r"\bSuperficie de\b", "Area of"),
    (r"\bArbolado\b", "Trees"),
    (r"\bPoblaci[oó]n\b", "Population"),
    (r"\bPadr[oó]n municipal\b", "Municipal register"),
    (r"\bHabitantes\b", "Inhabitants"),
    (r"\bResidentes\b", "Residents"),
    (r"\bPersonas mayores\b", "Older adults"),
    (r"\bMayores\b", "Older adults"),
    (r"\bTercera edad\b", "Older adults"),
    (r"\bLista de espera\b", "Waiting list"),
    (r"\bCenso\b", "Census"),
    (r"\bSecciones censales\b", "Census sections"),
    (r"\bSecci[oó]n censal\b", "Census section"),
    (r"\bDistritos\b", "Districts"),
    (r"\bDistrito\b", "District"),
    (r"\bBarrios\b", "Neighborhoods"),
    (r"\bBarrio\b", "Neighborhood"),
    (r"\bL[ií]mites administrativos\b", "Administrative boundaries"),
    (r"\bCartograf[ií]a\b", "Mapping"),
    (r"\bEstaciones de metro\b", "Metro stations"),
    (r"\bMetro Ligero\b", "Light rail"),
    (r"\bCercan[ií]as\b", "Commuter rail"),
    (r"\bEstaciones\b", "Stations"),
    (r"\bTransporte p[uú]blico\b", "Public transport"),
    (r"\bMovilidad\b", "Mobility"),
    (r"\bTr[aá]fico\b", "Traffic"),
    (r"\bVivienda\b", "Housing"),
    (r"\bAlquiler\b", "Rent"),
    (r"\bUrbanismo\b", "Urban planning"),
    (r"\bUso del suelo\b", "Land use"),
    (r"\bUsos del suelo\b", "Land uses"),
    (r"\bCatastro\b", "Cadastre"),
    (r"\bEquipamientos\b", "Facilities"),
    (r"\bCentros de salud\b", "Health centers"),
    (r"\bCentros educativos\b", "Education facilities"),
    (r"\bCentros\b", "Centers"),
    (r"\bSalud\b", "Health"),
    (r"\bEducaci[oó]n\b", "Education"),
    (r"\bEmpleo\b", "Employment"),
    (r"\bRenta\b", "Income"),
    (r"\bVulnerabilidad\b", "Vulnerability"),
    (r"\bDesigualdad\b", "Inequality"),
    (r"\bExpedientes sancionadores\b", "Enforcement cases"),
    (r"\bInformaci[oó]n relativa a\b", "Information about"),
    (r"\bInformaci[oó]n sobre\b", "Information about"),
    (r"\bDatos sobre\b", "Data about"),
    (r"\bRelaci[oó]n de\b", "List of"),
    (r"\bListado de\b", "List of"),
    (r"\bN[uú]mero de\b", "Number of"),
    (r"\bTotal de\b", "Total"),
    (r"\bpor distrito\b", "by district"),
    (r"\bpor barrio\b", "by neighborhood"),
    (r"\bpor secci[oó]n censal\b", "by census section"),
    (r"\bpor municipio\b", "by municipality"),
    (r"\bMunicipio de Madrid\b", "Municipality of Madrid"),
    (r"\bMunicipios\b", "Municipalities"),
    (r"\bMunicipio\b", "Municipality"),
    (r"\bAnual\b", "Annual"),
    (r"\bMensual\b", "Monthly"),
    (r"\bSemanal\b", "Weekly"),
    (r"\bDiario\b", "Daily"),
    (r"\benero\b", "January"),
    (r"\bfebrero\b", "February"),
    (r"\bmarzo\b", "March"),
    (r"\babril\b", "April"),
    (r"\bmayo\b", "May"),
    (r"\bjunio\b", "June"),
    (r"\bjulio\b", "July"),
    (r"\bagosto\b", "August"),
    (r"\bseptiembre\b", "September"),
    (r"\boctubre\b", "October"),
    (r"\bnoviembre\b", "November"),
    (r"\bdiciembre\b", "December"),
    (r"\bDesconocido\b", "Unknown"),
    (r"\bsin periodicidad\b", "no fixed frequency"),
    (r"\bactualizaci[oó]n\b", "update"),
    (r"\bfecha\b", "date"),
    (r"\bdetalle\b", "detail"),
    (r"\bdetalles\b", "details"),
    (r"\bAño\b", "Year"),
    (r"\bServicio de Estacionamiento Regulado\b", "Regulated Parking Service"),
    (r"\bTiques de aparcamiento\b", "Parking tickets"),
    (r"\bAutorizaciones\b", "Authorizations"),
    (r"\bPlaza El[ií]ptica\b", "Eliptica square"),
    (r"\bActuaciones de mejora\b", "Improvement works"),
)

WORD_TRANSLATIONS = (
    (r"\bdataset\b", "dataset"),
    (r"\bdatasets\b", "datasets"),
    (r"\bdato\b", "data"),
    (r"\bdatos\b", "data"),
    (r"\babiertos\b", "open"),
    (r"\babierto\b", "open"),
    (r"\bcallejero\b", "street map"),
    (r"\bcalles\b", "streets"),
    (r"\bcalle\b", "street"),
    (r"\bplazas\b", "squares"),
    (r"\bplaza\b", "square"),
    (r"\bparques\b", "parks"),
    (r"\bparque\b", "park"),
    (r"\bjardines\b", "gardens"),
    (r"\bjard[ií]n\b", "garden"),
    (r"\b[áa]reas\b", "areas"),
    (r"\b[áa]rea\b", "area"),
    (r"\bverde\b", "green"),
    (r"\bverdes\b", "green"),
    (r"\baire\b", "air"),
    (r"\btransporte\b", "transport"),
    (r"\bautob[uú]s\b", "bus"),
    (r"\bautobuses\b", "buses"),
    (r"\btren\b", "train"),
    (r"\bferrocarril\b", "railway"),
    (r"\bestaci[oó]n\b", "station"),
    (r"\bl[ií]nea\b", "line"),
    (r"\bl[ií]neas\b", "lines"),
    (r"\bacceso\b", "access"),
    (r"\baccesibilidad\b", "accessibility"),
    (r"\bdistancia\b", "distance"),
    (r"\bmetros\b", "meters"),
    (r"\bresidentes\b", "residents"),
    (r"\bresidente\b", "resident"),
    (r"\bmayor\b", "older adult"),
    (r"\bmayores\b", "older adults"),
    (r"\bviviendas\b", "housing units"),
    (r"\bvivienda\b", "housing"),
    (r"\bhogares\b", "households"),
    (r"\bhogar\b", "household"),
    (r"\bescuelas\b", "schools"),
    (r"\bcolegios\b", "schools"),
    (r"\bcolegio\b", "school"),
    (r"\bhospitales\b", "hospitals"),
    (r"\bhospital\b", "hospital"),
    (r"\by\b", "and"),
    (r"\baño\b", "year"),
    (r"\baceras\b", "sidewalks"),
    (r"\bacera\b", "sidewalk"),
    (r"\bcalzadas\b", "roadways"),
    (r"\bcalzada\b", "roadway"),
    (r"\bactuaciones\b", "works"),
    (r"\bactuacion\b", "work"),
    (r"\bactuaci[oó]n\b", "work"),
    (r"\bmejora\b", "improvement"),
    (r"\bcondiciones\b", "conditions"),
    (r"\bcondici[oó]n\b", "condition"),
    (r"\bim[aá]genes\b", "images"),
    (r"\bimagen\b", "image"),
    (r"\bexistentes\b", "existing"),
    (r"\bexistente\b", "existing"),
    (r"\brealizada\b", "created"),
    (r"\brealizado\b", "created"),
    (r"\bcontinua\b", "continuous"),
    (r"\bcontinuo\b", "continuous"),
)

SPANISH_SIGNAL = re.compile(
    r"\b(de|del|la|las|los|el|en|por|para|con|sobre|seg[uú]n|municipio|"
    r"distrito|barrio|poblaci[oó]n|vivienda|calidad|parques|zonas|datos)\b",
    re.IGNORECASE,
)
ACCENTED = re.compile(r"[áéíóúñÁÉÍÓÚÑ]")


def translate_catalog_text(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return raw
    if re.match(r"^datos\.gob\.es$", raw, re.IGNORECASE):
        return raw
    if not SPANISH_SIGNAL.search(raw) and not ACCENTED.search(raw):
        return raw

    translated = raw
    for pattern, replacement in (*PHRASE_TRANSLATIONS, *WORD_TRANSLATIONS):
        translated = re.sub(pattern, replacement, translated, flags=re.IGNORECASE)

    return cleanup_translated_text(translated)


def cleanup_translated_text(value: str) -> str:
    replacements = (
        (r"\bde la\b", "of the"),
        (r"\bde los\b", "of the"),
        (r"\bde las\b", "of the"),
        (r"\bdel\b", "of the"),
        (r"\bde\b", "of"),
        (r"\bla\b", "the"),
        (r"\blas\b", "the"),
        (r"\blos\b", "the"),
        (r"\bel\b", "the"),
        (r"\ben\b", "in"),
        (r"\bpor\b", "by"),
        (r"\bpara\b", "for"),
        (r"\bcon\b", "with"),
    )
    cleaned = value
    for pattern, replacement in replacements:
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s+([,.;:])", r"\1", re.sub(r"\s+", " ", cleaned)).strip()


def ensure_record_translations(data: Dict[str, Any]) -> Dict[str, Any]:
    title_original = str(data.get("title_original") or data.get("title") or "")
    description_original = str(data.get("description_original") or data.get("description") or "")

    data["title_original"] = title_original
    data["description_original"] = description_original
    existing_version = str(data.get("translation_version") or "")
    should_regenerate = existing_version != CATALOG_TRANSLATION_VERSION
    data["title_en"] = str(
        translate_catalog_text(title_original)
        if should_regenerate
        else data.get("title_en") or translate_catalog_text(title_original)
    )
    data["description_en"] = str(
        translate_catalog_text(description_original)
        if should_regenerate
        else data.get("description_en") or translate_catalog_text(description_original)
    )
    data["translation_method"] = str(data.get("translation_method") or "rule")
    data["translation_version"] = CATALOG_TRANSLATION_VERSION
    return data


def ensure_dataset_translations(dataset: Dataset) -> Dataset:
    dataset.title_original = dataset.title_original or dataset.title
    dataset.description_original = dataset.description_original or dataset.description
    should_regenerate = dataset.translation_version != CATALOG_TRANSLATION_VERSION
    if should_regenerate:
        dataset.title_en = translate_catalog_text(dataset.title_original)
        dataset.description_en = translate_catalog_text(dataset.description_original)
    else:
        dataset.title_en = dataset.title_en or translate_catalog_text(dataset.title_original)
        dataset.description_en = dataset.description_en or translate_catalog_text(dataset.description_original)
    dataset.translation_method = dataset.translation_method or "rule"
    dataset.translation_version = CATALOG_TRANSLATION_VERSION
    return dataset
