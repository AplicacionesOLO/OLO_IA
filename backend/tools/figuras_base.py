"""GENERA LAS FIGURAS BASE DEL ALMACEN COMO `.glb`, CON MEDIDAS REALES.

═══════════════════════════════════════════════════════════════════════════════
POR QUE SE GENERAN EN VEZ DE DESCARGARSE

Se buscaron primero. El resultado, medido:

  · Sketchfab tiene carretillas y palets descargables de sobra, pero NINGUNO en CC0: la
    consulta con `license=cc0` devuelve cero, y sin filtro salen doce carretillas, todas
    «CC Attribution».
  · Poly Haven es CC0 entero y no tiene ni carretilla ni palet — bidones, cajas de carton y
    estanterias de casa—.
  · Las tres fuentes que SI tienen packs CC0 de almacen —Kenney, itch.io y Quaternius— estan
    bloqueadas por red desde esta maquina: `kenney.nl` corta la conexion mientras
    `google.com` y `github.com` responden con 200.

Y para la mitad de estas piezas la descarga nunca fue la respuesta buena. Un pilar de acero
es un perfil en H; un tope de proteccion es una chapa doblada al pie de un montante; un cajon
demarcado es PINTURA en el suelo. Descargar un mesh fijo para eso trae el problema de siempre
—no encaja con las medidas del almacen— y encima trae una licencia que hay que arrastrar.

Generandolas: salen CC0 porque no son de nadie, pesan unos pocos KB, llevan cotas de catalogo
comercial, y este archivo es su procedencia. Un `.glb` en un bucket sin nada que explique de
donde salio es una figura que nadie se atreve a tocar dentro de un año.

═══════════════════════════════════════════════════════════════════════════════
QUE SON Y QUE NO SON

Son PRIMITIVAS con las medidas correctas, no modelos bonitos. La carretilla se reconoce como
carretilla a la distancia a la que se usa —diez metros, juzgando si cabe en un pasillo— y de
cerca es un chasis con un mastil. Eso es lo que hace falta para un gemelo digital y no lo que
hace falta para un catalogo comercial.

Se pueden sustituir sin tocar nada: la figura vive en el catalogo con su licencia, asi que
subir mañana una carretilla de Kenney y jubilar esta es cambiar una fila.

═══════════════════════════════════════════════════════════════════════════════
LAS COTAS, DE CATALOGO

  palet EUR/EPAL      1200 x 800 x 144 mm
  pilar IPE 300       300 x 150 mm de seccion, 6 m de alto
  tope de montante    400 mm de alto, para montante de 100 mm
  cajon de palet      1200 x 1000 mm, con pintura de 50 mm
  contrapesada 2,5 t  3,50 m con horquillas, 1,15 de ancho, 2,10 de mastil bajado

El eje Y es el VERTICAL y el origen esta en la BASE, que es la convencion de glTF. Con el
origen abajo, `apoyarEnElSuelo` del visor no tiene que corregir nada — aunque funciona igual
si algun dia se sube un modelo con el origen centrado, que es la mitad de los que hay—.
"""

from __future__ import annotations

import json
import math
import struct
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    #  Solo para las anotaciones: con `from __future__ import annotations` no hace falta en
    #  ejecucion, y este modulo lo importa un guion que se lanza a mano.
    from pathlib import Path

#  Cada pieza es una caja o un cilindro con su color, y se agrupan POR COLOR en primitivas.
#  Asi hay un material por color y ninguna textura: un `.glb` sin texturas pesa kilobytes y
#  se descarga instantaneo en la red de un almacen.
Color = tuple[float, float, float, float, float]  # r, g, b, metalico, rugosidad

MADERA: Color = (0.72, 0.55, 0.34, 0.0, 0.85)
ACERO: Color = (0.62, 0.66, 0.70, 0.85, 0.35)
ACERO_OSCURO: Color = (0.34, 0.37, 0.41, 0.75, 0.45)
AMARILLO: Color = (0.95, 0.74, 0.10, 0.10, 0.55)
PINTURA: Color = (0.93, 0.78, 0.16, 0.0, 0.75)
NARANJA: Color = (0.86, 0.35, 0.09, 0.15, 0.50)
NEGRO: Color = (0.09, 0.09, 0.10, 0.0, 0.80)
GRIS: Color = (0.45, 0.47, 0.50, 0.20, 0.60)


class Malla:
    """Acumula triangulos por color. Sin nada de glTF todavia: solo geometria."""

    def __init__(self) -> None:
        self.por_color: dict[Color, tuple[list[float], list[float], list[int]]] = {}

    def _bolsa(self, color: Color) -> tuple[list[float], list[float], list[int]]:
        return self.por_color.setdefault(color, ([], [], []))

    def caja(
        self,
        centro: tuple[float, float, float],
        tamano: tuple[float, float, float],
        color: Color,
    ) -> None:
        """Una caja con NORMALES PLANAS: 24 vertices, cuatro por cara.

        Con 8 vertices compartidos las normales salen promediadas y la caja se ve como una
        pastilla de jabon — el acero deja de parecer acero—. Veinticuatro vertices por caja
        son 288 bytes: en una figura de veinte cajas, nada.
        """
        cx, cy, cz = centro
        hx, hy, hz = (t / 2 for t in tamano)
        pos, nor, idx = self._bolsa(color)
        caras = (
            ((1.0, 0.0, 0.0), ((hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz))),
            ((-1.0, 0.0, 0.0), ((-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz))),
            ((0.0, 1.0, 0.0), ((-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz))),
            ((0.0, -1.0, 0.0), ((-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz))),
            ((0.0, 0.0, 1.0), ((-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz))),
            ((0.0, 0.0, -1.0), ((-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz), (-hx, -hy, -hz))),
        )
        for normal, esquinas in caras:
            base = len(pos) // 3
            for ex, ey, ez in esquinas:
                pos.extend((cx + ex, cy + ey, cz + ez))
                nor.extend(normal)
            idx.extend((base, base + 1, base + 2, base, base + 2, base + 3))

    def cilindro(
        self,
        centro: tuple[float, float, float],
        radio: float,
        largo: float,
        eje: str,
        color: Color,
        lados: int = 12,
    ) -> None:
        """Un cilindro de `lados` caras. Para las ruedas.

        Doce lados y no treinta y dos: una rueda mide 40 cm en una nave de 290 m, asi que la
        diferencia no se ve y son sesenta triangulos menos por rueda. Con cajas, en cambio,
        si se nota: una carretilla sobre cuatro cubos no se lee como una carretilla.
        """
        pos, nor, idx = self._bolsa(color)
        h = largo / 2
        ejes = {"x": (0, 1, 2), "y": (1, 2, 0), "z": (2, 0, 1)}[eje]

        def punto(a: float, r: float, d: float) -> tuple[float, float, float]:
            #  `a` recorre la circunferencia y `d` avanza a lo largo del eje.
            v = [0.0, 0.0, 0.0]
            v[ejes[0]] = d
            v[ejes[1]] = math.cos(a) * r
            v[ejes[2]] = math.sin(a) * r
            return (centro[0] + v[0], centro[1] + v[1], centro[2] + v[2])

        for i in range(lados):
            a0 = 2 * math.pi * i / lados
            a1 = 2 * math.pi * (i + 1) / lados
            #  La normal del costado apunta hacia fuera, perpendicular al eje.
            n = [0.0, 0.0, 0.0]
            am = (a0 + a1) / 2
            n[ejes[1]] = math.cos(am)
            n[ejes[2]] = math.sin(am)
            base = len(pos) // 3
            for p in (
                punto(a0, radio, -h),
                punto(a1, radio, -h),
                punto(a1, radio, h),
                punto(a0, radio, h),
            ):
                pos.extend(p)
                nor.extend(n)
            idx.extend((base, base + 1, base + 2, base, base + 2, base + 3))

        #  Las dos tapas, en abanico desde el centro.
        for signo in (-1, 1):
            n = [0.0, 0.0, 0.0]
            n[ejes[0]] = float(signo)
            base = len(pos) // 3
            pos.extend(punto(0.0, 0.0, signo * h))
            nor.extend(n)
            for i in range(lados + 1):
                pos.extend(punto(2 * math.pi * i / lados, radio, signo * h))
                nor.extend(n)
            for i in range(lados):
                if signo > 0:
                    idx.extend((base, base + 1 + i, base + 2 + i))
                else:
                    idx.extend((base, base + 2 + i, base + 1 + i))

    def caja_envolvente(self) -> tuple[list[float], list[float]]:
        """Lo que mide la figura. Es lo que se guarda como `size_x_m` y compañia."""
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        for pos, _n, _i in self.por_color.values():
            for k in range(0, len(pos), 3):
                for j in range(3):
                    lo[j] = min(lo[j], pos[k + j])
                    hi[j] = max(hi[j], pos[k + j])
        return (lo, hi)

    def triangulos(self) -> int:
        return sum(len(i) // 3 for _p, _n, i in self.por_color.values())


def escribir_glb(malla: Malla, destino: Path, nombre: str) -> int:
    """Escribe un glTF 2.0 binario y devuelve los bytes.

    A mano y sin libreria porque un `.glb` de cajas son tres cosas: un JSON, un buffer y una
    cabecera de doce bytes. Traer una dependencia para eso seria traer su mantenimiento a
    cambio de nada.
    """
    binario = bytearray()
    #  Cada uno es un trozo de glTF, o sea JSON: clave de texto y cualquier valor.
    accesores: list[dict[str, Any]] = []
    vistas: list[dict[str, Any]] = []
    materiales: list[dict[str, Any]] = []
    primitivas: list[dict[str, Any]] = []

    def anadir(datos: bytes, objetivo: int) -> int:
        #  Todo alineado a 4 bytes: glTF lo exige, y un desalineado no falla al escribir
        #  sino al cargar, con un mensaje que no dice cual.
        while len(binario) % 4:
            binario.append(0)
        desplazamiento = len(binario)
        binario.extend(datos)
        vistas.append(
            {
                "buffer": 0,
                "byteOffset": desplazamiento,
                "byteLength": len(datos),
                "target": objetivo,
            }
        )
        return len(vistas) - 1

    for color, (pos, nor, idx) in malla.por_color.items():
        r, g, b, metalico, rugosidad = color
        materiales.append(
            {
                "pbrMetallicRoughness": {
                    "baseColorFactor": [r, g, b, 1.0],
                    "metallicFactor": metalico,
                    "roughnessFactor": rugosidad,
                }
            }
        )
        vp = anadir(struct.pack(f"<{len(pos)}f", *pos), 34962)
        accesores.append(
            {
                "bufferView": vp,
                "componentType": 5126,
                "count": len(pos) // 3,
                "type": "VEC3",
                #  `min` y `max` son OBLIGATORIOS en el accesor de posiciones: de ahi saca el
                #  visor la caja envolvente sin recorrer la geometria.
                "min": [min(pos[k::3]) for k in range(3)],
                "max": [max(pos[k::3]) for k in range(3)],
            }
        )
        ap = len(accesores) - 1
        vn = anadir(struct.pack(f"<{len(nor)}f", *nor), 34962)
        accesores.append(
            {"bufferView": vn, "componentType": 5126, "count": len(nor) // 3, "type": "VEC3"}
        )
        an = len(accesores) - 1
        #  Indices de 32 bits sin condiciones: los de 16 se pasan a los 65.536 vertices y el
        #  desbordamiento no da error, dibuja mal. Cuatro bytes por indice son 12 KB en una
        #  figura de mil triangulos.
        vi = anadir(struct.pack(f"<{len(idx)}I", *idx), 34963)
        accesores.append(
            {"bufferView": vi, "componentType": 5125, "count": len(idx), "type": "SCALAR"}
        )
        primitivas.append(
            {
                "attributes": {"POSITION": ap, "NORMAL": an},
                "indices": len(accesores) - 1,
                "material": len(materiales) - 1,
            }
        )

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "OLO_IA backend/tools/figuras_base.py",
            #  La licencia viaja DENTRO del archivo y no solo en la fila del catalogo: si el
            #  `.glb` se copia a otro sitio, sigue diciendo lo que es.
            "copyright": "CC0 1.0 Universal (dominio publico). Generado por OLO_IA.",
        },
        "scene": 0,
        "scenes": [{"nodes": [0], "name": nombre}],
        "nodes": [{"mesh": 0, "name": nombre}],
        "meshes": [{"primitives": primitivas, "name": nombre}],
        "materials": materiales,
        "accessors": accesores,
        "bufferViews": vistas,
        "buffers": [{"byteLength": len(binario)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = bytes(binario) + b"\0" * ((4 - len(binario) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with destino.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_bytes), 0x004E4942))
        f.write(bin_bytes)
    return total
