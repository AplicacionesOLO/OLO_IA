/**
 * EL 204 SIN CUERPO.
 *
 * Estas pruebas existen por un fallo concreto y del peor tipo: `patch` y `put` leían
 * `res.data` de una respuesta que no traía cuerpo, así que lanzaban
 * `TypeError: Cannot read properties of undefined (reading 'data')` DESPUÉS de que la
 * escritura ya hubiera ocurrido. La fila quedaba guardada en la base y la pantalla
 * decía «Error».
 *
 * Se descubrió al editar un rol desde la interfaz, pero lo padecían los seis editores
 * de Configuración y el conmutador de la matriz de permisos.
 *
 * Y volvió a pasar con `post`, que se había quedado fuera del arreglo porque hasta
 * entonces ningún POST del backend respondía sin cuerpo. Al añadir archivar y
 * desarchivar inspecciones —dos POST que responden 204— la inspección SÍ se archivaba,
 * la promesa se rechazaba, el `onSuccess` de la mutación no llegaba a correr y el botón
 * se quedaba igual sin un solo mensaje. Costó una hora de diagnóstico.
 *
 * Lo que se fija aquí es el CONTRATO, no la implementación: la mayoría de las
 * escrituras del backend responden 204 y estos atajos tienen que devolver sin
 * reventar. Si alguien vuelve a poner `res.data` a secas, estas tres fallan.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from './apiClient';

function cliente(respuesta: Response) {
  const fetchFalso = vi.fn().mockResolvedValue(respuesta);
  vi.stubGlobal('fetch', fetchFalso);
  const api = new ApiClient({
    baseUrl: 'http://api.local/v1',
    getAccessToken: () => 'token',
    onRefreshNeeded: () => Promise.resolve(null),
    onSessionLost: () => undefined,
    getWarehouseId: () => null,
  });
  return { api, fetchFalso };
}

const sinCuerpo = () => new Response(null, { status: 204 });
const conCuerpo = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('ApiClient · escrituras que responden 204', () => {
  it('patch no revienta cuando el backend responde 204 sin cuerpo', async () => {
    const { api } = cliente(sinCuerpo());
    await expect(api.patch('/admin/roles/abc', { description: 'x' })).resolves.toBeUndefined();
  });

  it('put no revienta cuando el backend responde 204 sin cuerpo', async () => {
    const { api } = cliente(sinCuerpo());
    // La matriz de permisos va por aquí: `PUT /admin/roles/{id}/permissions/{code}`.
    await expect(
      api.put('/admin/roles/abc/permissions/clients:read', { granted: true }),
    ).resolves.toBeUndefined();
  });

  it('post no revienta cuando el backend responde 204 sin cuerpo', async () => {
    const { api } = cliente(sinCuerpo());
    // Archivar y desarchivar una inspección van por aquí, y son POST sin cuerpo.
    await expect(
      api.post('/perception/jobs/abc/archive'),
    ).resolves.toBeUndefined();
  });

  it('post sigue devolviendo el recurso cuando el backend sí manda cuerpo', async () => {
    // La mayoría de los POST devuelven el recurso creado —una incidencia, una zona— y
    // eso no puede romperse al tolerar el 204.
    const { api } = cliente(conCuerpo({ id: 'nueva', name: 'zona' }));
    await expect(api.post('/inventory/warehouses/w/clusters', { name: 'zona' })).resolves.toEqual(
      { id: 'nueva', name: 'zona' },
    );
  });

  it('patch sigue devolviendo el recurso cuando el backend sí manda cuerpo', async () => {
    // Tolerar el 204 no debe convertir el atajo en «devuelve undefined siempre»: hay
    // endpoints que responden 200 con el recurso, y esos tienen que seguir llegando.
    const { api } = cliente(conCuerpo({ id: 'abc', name: 'nuevo' }));
    await expect(api.patch('/admin/clients/abc', { name: 'nuevo' })).resolves.toEqual({
      id: 'abc',
      name: 'nuevo',
    });
  });
});
