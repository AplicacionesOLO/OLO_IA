"""EL NOMBRE DE UNA CLASE ES UNA CLAVE, NO UNA ETIQUETA PARA LEER.

── QUE SE PROTEGE AQUI ─────────────────────────────────────────────────────────────

Que el worker pueda seguir comparando nombres con `==` y acertar. Lo hace en tres sitios
que deciden cosas distintas:

    CLASES_DE_CODIGO    = {"qr_ubicacion", "qr_pallet"}      ¿lleva codigo?
    CLASES_CON_PRUEBA   = {..., "pallet", "hueco_vacio"}     ¿se guarda recorte?
    CLASES_DE_UBICACION = {"qr_ubicacion"}                   ¿se promueve a observacion?

Las tres son comparaciones exactas, y ese es el problema: una clase creada como `Larguero`
no casa nunca con un `"larguero"` del codigo, y el sintoma NO es un error. Es una
deteccion sin recorte o un hueco que no se promueve, sin una linea en ningun log.

Paso de verdad: `Larguero` y `Paral` se crearon con mayuscula desde la pantalla. Se
arreglaron con cero anotaciones encima; con anotaciones habria tocado migrar y reentrenar.

La decision de fondo que estas pruebas fijan: el nombre se NORMALIZA, no se rechaza. Quien
lo escribe pone «Larguero» porque asi se dice, y devolverle un error de validacion seria
trasladarle un detalle nuestro.
"""

from __future__ import annotations

import pytest

from olo.domain.ai.klass import normalizar_nombre
from olo.domain.warehouse import DomainRuleError


def test_la_capitalizacion_deja_de_importar():
    #  El caso exacto que se colo desde la pantalla.
    assert normalizar_nombre("Larguero") == "larguero"
    assert normalizar_nombre("Paral") == "paral"
    assert normalizar_nombre("PARAL") == "paral"


def test_las_clases_que_ya_existen_no_cambian():
    """La comprobacion que impide una migracion silenciosa del vocabulario entero.

    Si `normalizar_nombre` tocara estas cinco, las 159 anotaciones que hay en la base
    quedarian apuntando a nombres que ya no existen — y el worker dejaria de guardar
    recortes sin decir nada—.
    """
    for ya_canonico in (
        "qr_ubicacion",
        "qr_pallet",
        "pallet",
        "hueco_vacio",
        "etiqueta_ilegible",
    ):
        assert normalizar_nombre(ya_canonico) == ya_canonico


def test_los_espacios_y_los_guiones_se_vuelven_guion_bajo():
    #  El nombre viaja a los ficheros del dataset del entrenamiento: un espacio ahi es
    #  otro problema del mismo origen.
    assert normalizar_nombre("Hueco Vacio") == "hueco_vacio"
    assert normalizar_nombre("montante-aereo") == "montante_aereo"
    assert normalizar_nombre("  paral  ") == "paral"
    #  Y no deja guiones bajos pegando en los extremos ni repetidos.
    assert normalizar_nombre("__paral / larguero__") == "paral_larguero"


def test_las_tildes_y_la_ene_pierden_el_adorno():
    #  `Ubicación` y `ubicacion` tienen que ser la MISMA clave: si no, el dia que alguien
    #  cree la clase con tilde tendra dos vocabularios que se parecen.
    assert normalizar_nombre("Ubicación") == "ubicacion"
    assert normalizar_nombre("Peldaño") == "peldano"


def test_un_nombre_que_no_deja_nada_se_rechaza():
    """Aqui SI se rechaza, y es la excepcion coherente: normalizar `***` da la cadena
    vacia, y una clase sin nombre no se puede comparar con nada."""
    assert normalizar_nombre("***") == ""
    assert normalizar_nombre("   ") == ""


def test_la_entidad_normaliza_al_construirse():
    """Doble red. El servicio normaliza antes del INSERT —que es lo que llega a la base—,
    y la entidad tambien: asi un camino nuevo que construya `AiClass` sin pasar por el
    servicio no vuelve a meter un `Larguero`."""
    from datetime import UTC, datetime
    from uuid import uuid4

    from olo.domain.ai.klass import AiClass

    c = AiClass(
        id=uuid4(),
        project_id=uuid4(),
        name="Larguero",
        class_index=5,
        color="#F472B6",
        is_active=True,
        version=1,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    assert c.name == "larguero"

    with pytest.raises(DomainRuleError):
        AiClass(
            id=uuid4(),
            project_id=uuid4(),
            name="***",
            class_index=7,
            color="#F472B6",
            is_active=True,
            version=1,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
