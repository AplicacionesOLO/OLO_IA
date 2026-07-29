/**
 * FOCUSCONTEXT — coherencia neuronal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Implementa el rasgo G3 del ADN: TODO ESTA CONECTADO Y SE VE.
 *
 * Los paneles no son islas. Cuando el usuario enfoca una entidad, las
 * conexiones a esa entidad se iluminan en todos los paneles simultaneamente.
 * El sistema demuestra que SABE que esos datos estan relacionados.
 *
 * Sin clicks, sin recargas: solo hover.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IMPLEMENTACION SIN RE-RENDERS GLOBALES
 *
 * Un contexto con estado haria re-renderizar todo el arbol en cada hover, lo
 * que a 60 Hz es inviable. En su lugar se usa un store de suscripcion: solo los
 * componentes que representan la entidad enfocada (o una relacionada) se
 * re-renderizan.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface EntityRef {
  type: string;
  id: string;
}

export function entityKey(e: EntityRef): string {
  return `${e.type}:${e.id}`;
}

export function sameEntity(a: EntityRef | null, b: EntityRef | null): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

interface FocusStore {
  get: () => EntityRef | null;
  set: (e: EntityRef | null) => void;
  subscribe: (fn: () => void) => () => void;
  /** Relaciones conocidas: clave de entidad → claves relacionadas. */
  relate: (from: EntityRef, to: readonly EntityRef[]) => void;
  getRelated: () => ReadonlySet<string>;
}

const FocusStoreContext = createContext<FocusStore | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const focusedRef = useRef<EntityRef | null>(null);
  const relationsRef = useRef(new Map<string, Set<string>>());
  const relatedRef = useRef<ReadonlySet<string>>(new Set());
  const subscribersRef = useRef(new Set<() => void>());

  const store = useMemo<FocusStore>(
    () => ({
      get: () => focusedRef.current,
      getRelated: () => relatedRef.current,
      set: (e) => {
        if (sameEntity(focusedRef.current, e)) return;
        focusedRef.current = e;
        // Se precalcula el conjunto de relacionados una vez por cambio de foco,
        // no una vez por componente que pregunta.
        relatedRef.current = e
          ? (relationsRef.current.get(entityKey(e)) ?? new Set<string>())
          : new Set<string>();
        subscribersRef.current.forEach((fn) => fn());
      },
      subscribe: (fn) => {
        subscribersRef.current.add(fn);
        return () => {
          subscribersRef.current.delete(fn);
        };
      },
      relate: (from, to) => {
        const key = entityKey(from);
        const set = relationsRef.current.get(key) ?? new Set<string>();
        for (const t of to) set.add(entityKey(t));
        relationsRef.current.set(key, set);
        // La relacion es bidireccional: si A se relaciona con B, enfocar B debe
        // iluminar A. Sin esto la coherencia seria asimetrica y confusa.
        for (const t of to) {
          const tk = entityKey(t);
          const rev = relationsRef.current.get(tk) ?? new Set<string>();
          rev.add(key);
          relationsRef.current.set(tk, rev);
        }
      },
    }),
    [],
  );

  return <FocusStoreContext.Provider value={store}>{children}</FocusStoreContext.Provider>;
}

function useFocusStore(): FocusStore {
  const ctx = useContext(FocusStoreContext);
  if (!ctx) throw new Error('useFocus debe usarse dentro de FocusProvider');
  return ctx;
}

/** Fija o limpia el foco. No provoca re-render en el componente que lo llama. */
export function useSetFocus(): (e: EntityRef | null) => void {
  return useFocusStore().set;
}

/** Declara relaciones para que la coherencia neuronal las conozca. */
export function useRelateEntities(): (from: EntityRef, to: readonly EntityRef[]) => void {
  return useFocusStore().relate;
}

/**
 * Estado de foco de UNA entidad concreta.
 *
 * Solo re-renderiza cuando el estado de ESTA entidad cambia, no en cada cambio
 * global de foco. Es lo que hace el patron viable con cientos de entidades en
 * pantalla.
 */
export function useEntityFocus(entity: EntityRef | null): {
  isFocused: boolean;
  isRelated: boolean;
} {
  const store = useFocusStore();
  const key = entity ? entityKey(entity) : null;

  const compute = useCallback(() => {
    if (!entity || !key) return { isFocused: false, isRelated: false };
    return {
      isFocused: sameEntity(store.get(), entity),
      isRelated: store.getRelated().has(key),
    };
  }, [store, entity, key]);

  const [state, setState] = useState(compute);

  useEffect(() => {
    const update = () => {
      const next = compute();
      // Comparacion de campos: sin esto, cada cambio global de foco produciria
      // un setState con un objeto nuevo y por tanto un re-render inutil.
      setState((prev) =>
        prev.isFocused === next.isFocused && prev.isRelated === next.isRelated ? prev : next,
      );
    };
    update();
    return store.subscribe(update);
  }, [store, compute]);

  return state;
}
