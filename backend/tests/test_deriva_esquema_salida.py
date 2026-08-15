"""LO QUE EL REPOSITORIO DEVUELVE TIENE QUE CABER EN LO QUE LA API DECLARA.

── LOS DOS FALLOS QUE ESTO CAZA, Y COMO SE VEIAN ─────────────────────────────

`ApiModel` lleva `extra="forbid"`, que es lo correcto: un campo de mas es una deriva
entre la base y el contrato. Pero el fallo llega en tiempo de EJECUCION y en forma de
500, y ninguno de los dos se leyo como un error:

1. 0091 anadio `crop_path` a las columnas de `perception.detections` y nadie lo declaro
   en `DetectionOut`. `GET /jobs/{id}/detections` respondia 500 a TODA peticion desde
   entonces. En la pantalla: un video que se reproduce sin una sola caja dibujada.

2. La misma migracion trajo las rutas de los recortes a la lectura. Al firmarlas se
   AÑADIAN las URLs sin quitar las rutas, asi que cada fila llevaba tres campos que
   `LocationInspectionOut` no declara. `GET /warehouses/{id}/inspection` respondia 500
   siempre. En la pantalla: la capa «Inspeccion» vacia y los huecos del plano 3D sin
   color, sin ningun mensaje de fallo — se reconciliaba, las lecturas salian en la tabla,
   y el mapa seguia en blanco.

Las dos veces el sintoma fue «no se ve», que es el peor: parece falta de datos y manda a
buscar donde no es.
"""

from olo.api.v1.schemas import DetectionOut, LocationInspectionOut
from olo.repositories.perception import _DET_COLS
from olo.services.spatial import RUTAS_DE_RECORTE, _con_firmas


def test_toda_columna_de_deteccion_esta_declarada() -> None:
    """El repositorio no puede devolver una columna que el contrato no admita."""
    columnas = {c.strip() for c in _DET_COLS.split(",")}
    declarados = set(DetectionOut.model_fields)
    assert columnas <= declarados, f"sin declarar en DetectionOut: {sorted(columnas - declarados)}"


def test_la_deteccion_valida_con_todas_sus_columnas() -> None:
    """La prueba de verdad: se construye una fila COMPLETA y se valida.

    Contar nombres no basta —un tipo equivocado tambien es un 500—, asi que se pasa por
    el validador igual que lo hace el endpoint.
    """
    fila = {
        "id": "5a3c1b6e-0000-4000-8000-000000000001",
        "job_id": "5a3c1b6e-0000-4000-8000-000000000002",
        "observed_at": "2026-08-15T03:10:00Z",
        "ingested_at": "2026-08-15T03:10:05Z",
        "frame_number": 12,
        "frame_ms": 14707,
        "frame_ref": None,
        "class_name": "qr_ubicacion",
        "ai_class_id": None,
        "class_color": "#34d399",
        "confidence": 0.91,
        "bbox_x": 0.1, "bbox_y": 0.2, "bbox_width": 0.05, "bbox_height": 0.04,
        "bbox_format": "normalized",
        "text_value": "RCL47-C018-N01-2",
        "crop_path": None,
        "state": "unmatched",
        "rack_node_id": None,
        "review_status": "pending",
        "reviewed_at": None,
        "review_comment": None,
        "supersedes_id": None,
        "is_manual": False,
    }
    assert set(fila) == {c.strip() for c in _DET_COLS.split(",")}
    assert DetectionOut.model_validate(fila).class_name == "qr_ubicacion"


def test_las_rutas_se_sustituyen_por_las_firmas_no_se_suman() -> None:
    """El defecto 2, aislado: lo que sale NO puede llevar rutas."""
    fila = {
        "location_id": "5a3c1b6e-0000-4000-8000-000000000003",
        "crop_location_path": "t/w/j/recorte_0_0_qr_ubicacion.jpg",
        "crop_content_path": None,
        "crop_pallet_path": "t/w/j/recorte_0_1_qr_pallet.jpg",
        "status": "unexpected_pallet",
    }
    salida = _con_firmas(
        fila,
        {"crop_location_url": "https://…/firmada", "crop_content_url": None,
         "crop_pallet_url": None},
    )
    assert not (set(salida) & set(RUTAS_DE_RECORTE))
    assert salida["crop_location_url"] == "https://…/firmada"
    #  Y lo que no tiene que ver con los recortes sigue intacto.
    assert salida["status"] == "unexpected_pallet"


def test_la_lectura_firmada_pasa_el_contrato() -> None:
    """De extremo a extremo del transformador: una fila real valida contra el esquema."""
    fila = {
        "location_id": "5a3c1b6e-0000-4000-8000-000000000003",
        "location_code": "RCL47-C018-N01-2",
        "observed_pallet_code": "22O0010471953",
        "expected_pallets": [],
        "status": "unexpected_pallet",
        "content": "pallet",
        "confidence": 0.88,
        "observed_at": "2026-08-15T03:10:00Z",
        "scan_id": "5a3c1b6e-0000-4000-8000-000000000004",
        "frame_ms": 9200,
        "rack_id": None, "bay_index": 18, "level": 1, "position": 2,
        #  Las tres rutas que venian de la base y reventaban el contrato.
        "crop_location_path": "t/w/j/a.jpg",
        "crop_content_path": None,
        "crop_pallet_path": None,
    }
    firmadas = {"crop_location_url": "https://…/a", "crop_content_url": None,
                "crop_pallet_url": None}
    salida = LocationInspectionOut.model_validate(_con_firmas(fila, firmadas))
    assert salida.location_code == "RCL47-C018-N01-2"
    assert salida.crop_location_url == "https://…/a"
