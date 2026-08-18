"""LAS CINCO FIGURAS BASE: palet, pilar, tope, cajon demarcado y carretilla.

Cada funcion devuelve la malla y la ficha que va al catalogo —nombre, categoria, licencia y
medidas—. Las medidas NO se escriben a mano: se miden sobre la geometria que se acaba de
construir, porque escribirlas dos veces es la forma de que un dia no coincidan y el visor
coloque una carretilla de dos metros donde va una de dos y medio.

Uso:
    python tools/figuras_generar.py <carpeta_destino>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from figuras_base import (
    ACERO,
    ACERO_OSCURO,
    AMARILLO,
    GRIS,
    MADERA,
    NARANJA,
    NEGRO,
    PINTURA,
    Malla,
    escribir_glb,
)


def palet_euro() -> Malla:
    """Palet EUR/EPAL: 1200 x 800 x 144 mm exactos.

    Se construye como es de verdad —tres tablas abajo, nueve tacos, tres patines y cinco
    tablas arriba— porque el hueco entre tacos es por donde entran las horquillas, y ese
    hueco es lo que hace que un palet se lea como un palet y no como una tabla.

    Las tablas de los BORDES van a ras del canto, no centradas sobre los tacos. Centradas
    sobresalian 22 mm por cada lado y el palet media 1245 x 845: un palet que no cabe donde
    cabe un palet, y el error solo se ve al medirlo.

    El espesor va en capas de 22 + 78 + 22 + 22 = 144 mm, que es la norma.
    """
    m = Malla()
    largo, ancho = 1.2, 0.8
    e = 0.022   # espesor de tabla
    taco = 0.078
    #  Tres tablas de abajo de 1200 x 100, la del centro y las dos a ras del canto.
    for z in (-(ancho / 2 - 0.05), 0.0, ancho / 2 - 0.05):
        m.caja((0.0, e / 2, z), (largo, e, 0.1), MADERA)
    #  Nueve tacos de 100 x 100 x 78, en rejilla, tambien a ras.
    for x in (-(largo / 2 - 0.05), 0.0, largo / 2 - 0.05):
        for z in (-(ancho / 2 - 0.05), 0.0, ancho / 2 - 0.05):
            m.caja((x, e + taco / 2, z), (0.1, taco, 0.1), MADERA)
    #  Tres patines de 800 x 145 sobre los tacos.
    for x in (-(largo / 2 - 0.0725), 0.0, largo / 2 - 0.0725):
        m.caja((x, e + taco + e / 2, 0.0), (0.145, e, ancho), MADERA)
    #  Cinco tablas arriba de 1200, alternando 145 y 100 mm, con los huecos repartidos.
    anchos = (0.145, 0.1, 0.145, 0.1, 0.145)
    hueco = (ancho - sum(anchos)) / (len(anchos) - 1)
    borde = -ancho / 2
    for w in anchos:
        m.caja((0.0, e + taco + e + e / 2, borde + w / 2), (largo, e, w), MADERA)
        borde += w + hueco
    return m


def pilar_acero() -> Malla:
    """Pilar de nave, perfil en H tipo IPE 300: 300 x 150 mm, 6 m.

    Perfil en H y no un tubo: es lo que se ve en una nave, y de lejos la sombra entre las
    alas es lo que lo distingue de un montante de rack. Con 6 m de alto se escala a lo que
    mida la nave — la escala vive en el catalogo—.
    """
    m = Malla()
    alto, canto, ala, e_ala, e_alma = 6.0, 0.3, 0.15, 0.011, 0.0071
    #  Las dos alas y el alma. Un IPE 300 real tiene 10,7 mm de ala y 7,1 de alma.
    for z in (-(canto - e_ala) / 2, (canto - e_ala) / 2):
        m.caja((0.0, alto / 2, z), (ala, alto, e_ala), ACERO)
    m.caja((0.0, alto / 2, 0.0), (e_alma, alto, canto - 2 * e_ala), ACERO)
    #  Placa de anclaje: 400 x 400 x 20, la que se ve al pie.
    m.caja((0.0, 0.01, 0.0), (0.4, 0.02, 0.4), ACERO_OSCURO)
    return m


def tope_proteccion() -> Malla:
    """Protector de montante: 400 mm de alto, para montante de 100 mm.

    Es una chapa doblada en U que abraza el pie del montante por delante, con su placa
    atornillada al suelo. Va en amarillo de seguridad porque para eso esta: para verse.
    """
    m = Malla()
    alto, e = 0.4, 0.006
    ancho_libre, fondo = 0.14, 0.11
    #  Frente y dos costados: la U abierta hacia el rack.
    m.caja((0.0, alto / 2 + 0.008, fondo / 2), (ancho_libre, alto, e), AMARILLO)
    for x in (-(ancho_libre - e) / 2, (ancho_libre - e) / 2):
        m.caja((x, alto / 2 + 0.008, 0.0), (e, alto, fondo), AMARILLO)
    #  Placa de anclaje al suelo, 180 x 180 x 8.
    m.caja((0.0, 0.004, 0.02), (0.18, 0.008, 0.18), ACERO_OSCURO)
    return m


def cajon_demarcado() -> Malla:
    """Cajon de suelo para un palet: 1200 x 1000 mm, pintura de 50 mm.

    Es PINTURA, asi que son cuatro tiras planas de 5 mm y nada mas. Los 5 mm no son
    decorativos: a cero coincidiria con el plano del suelo y las dos superficies se pelearian
    por el mismo pixel, que es el parpadeo clasico de esta clase de marcas.

    Va con las esquinas ABIERTAS —las tiras no se cruzan— porque asi se pinta de verdad y
    porque una esquina cerrada a esta escala se ve como un borron.
    """
    m = Malla()
    largo, ancho, w, e = 1.2, 1.0, 0.05, 0.005
    hueco = 0.12  # cuanto se abre cada esquina
    #  Dos tiras a lo largo y dos a lo ancho, acortadas para dejar la esquina abierta.
    for z in (-(ancho - w) / 2, (ancho - w) / 2):
        m.caja((0.0, e / 2, z), (largo - 2 * hueco, e, w), PINTURA)
    for x in (-(largo - w) / 2, (largo - w) / 2):
        m.caja((x, e / 2, 0.0), (w, e, ancho - 2 * hueco), PINTURA)
    return m


def carretilla_contrapesada() -> Malla:
    """Contrapesada de 2,5 t: 3,50 m con horquillas, 1,14 de ancho, 2,10 de mastil bajado.

    Las cotas son las que deciden si cabe en un pasillo, que es para lo que se pone en el
    plano. La primera version medía 2,62 m de largo y eso no es una contrapesada de 2,5 t:
    son 2,35 m hasta la cara de las horquillas mas 1,15 de horquilla. Con la medida corta,
    un pasillo estrecho habria pasado por bueno.

    La CARA DE LAS HORQUILLAS esta en z = 0 y todo el vehiculo queda detras, en z negativa.
    Asi la horquilla entra en el palet que este delante de la figura, y girar la figura en el
    plano gira lo que se espera.
    """
    m = Malla()
    #  Horquillas de 1,15 m y su tablero.
    for x in (-0.26, 0.26):
        m.caja((x, 0.025, 0.575), (0.12, 0.05, 1.15), ACERO)
    m.caja((0.0, 0.40, -0.03), (0.80, 0.46, 0.06), ACERO)
    #  Mastil: dos guias y el travesaño de arriba.
    for x in (-0.30, 0.30):
        m.caja((x, 1.05, -0.14), (0.10, 2.10, 0.16), ACERO_OSCURO)
    m.caja((0.0, 2.02, -0.14), (0.70, 0.10, 0.16), ACERO_OSCURO)
    #  Chasis, asiento y respaldo.
    m.caja((0.0, 0.42, -1.00), (0.98, 0.56, 1.40), NARANJA)
    m.caja((0.0, 0.76, -1.05), (0.52, 0.12, 0.46), NEGRO)
    m.caja((0.0, 1.00, -1.32), (0.52, 0.40, 0.10), NEGRO)
    #  Contrapeso: la masa de atras, que es la mitad del peso de la maquina.
    m.caja((0.0, 0.52, -2.02), (0.98, 0.76, 0.66), NARANJA)
    #  Cabina: cuatro postes y el techo protector, a 2,05 m.
    for x in (-0.44, 0.44):
        for z in (-0.62, -1.42):
            m.caja((x, 1.24, z), (0.06, 1.48, 0.06), GRIS)
    m.caja((0.0, 2.01, -1.02), (0.98, 0.06, 0.92), GRIS)
    #  Ruedas: las de carga, delante y mas grandes; las directrices, detras.
    for x in (-0.48, 0.48):
        m.cilindro((x, 0.25, -0.45), 0.25, 0.18, "x", NEGRO)
    for x in (-0.40, 0.40):
        m.cilindro((x, 0.19, -2.05), 0.19, 0.14, "x", NEGRO)
    return m


#: Nombre de archivo, funcion, y la ficha del catalogo. `kind` es una de las CATEGORIAS
#: cerradas del dominio: cambiarla por texto libre la rechaza la base.
FIGURAS = (
    ("palet_euro", palet_euro, "Palet EUR/EPAL 1200x800", "tarima"),
    ("pilar_acero", pilar_acero, "Pilar de acero IPE 300 (6 m)", "mobiliario"),
    ("tope_proteccion_rack", tope_proteccion, "Tope de proteccion de montante", "mobiliario"),
    ("cajon_demarcado", cajon_demarcado, "Cajon demarcado de palet 1200x1000", "senal"),
    (
        "carretilla_contrapesada",
        carretilla_contrapesada,
        "Carretilla contrapesada 2,5 t",
        "montacargas",
    ),
)

LICENCIA = "CC0-1.0"
NOTA = (
    "Primitiva generada por backend/tools/figuras_generar.py con cotas de catalogo "
    "comercial. No es un modelo detallado: sirve para juzgar tamaños y holguras en el "
    "plano. Sustituible por otro modelo sin tocar codigo."
)


def main() -> int:
    destino = Path(sys.argv[1] if len(sys.argv) > 1 else "figuras")
    destino.mkdir(parents=True, exist_ok=True)
    fichas = []
    for archivo, hacer, nombre, kind in FIGURAS:
        malla = hacer()
        ruta = destino / f"{archivo}.glb"
        octetos = escribir_glb(malla, ruta, archivo)
        lo, hi = malla.caja_envolvente()
        ficha = {
            "file": ruta.name,
            "name": nombre,
            "kind": kind,
            "license": LICENCIA,
            "notes": NOTA,
            #  Medidas SACADAS de la geometria, no escritas a mano.
            "size_x_m": round(hi[0] - lo[0], 4),
            "size_y_m": round(hi[1] - lo[1], 4),
            "size_z_m": round(hi[2] - lo[2], 4),
            "bytes": octetos,
            "triangulos": malla.triangulos(),
            #  Cuanto se despega del suelo el origen. Deberia ser 0 en todas: si alguna sale
            #  distinta, la figura no esta construida desde la base y el visor tendria que
            #  corregirla.
            "base_y": round(lo[1], 6),
        }
        fichas.append(ficha)
        print(
            f"{ruta.name:<30} {octetos:>7} B  {malla.triangulos():>5} tri  "
            f"{ficha['size_x_m']:>6} x {ficha['size_z_m']:>6} x {ficha['size_y_m']:>6} m  "
            f"base_y={ficha['base_y']}"
        )
    (destino / "figuras.json").write_text(
        json.dumps(fichas, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nficha: {destino / 'figuras.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
