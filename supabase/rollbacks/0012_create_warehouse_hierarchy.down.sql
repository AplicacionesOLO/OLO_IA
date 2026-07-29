-- Rollback de 0012_create_warehouse_hierarchy.sql
-- Orden inverso: locations depende de areas, areas de warehouses.
-- SIN CASCADE: las tablas de inventario (fase 1) apuntaran aqui; entonces
-- estos DROP fallaran a proposito antes que destruir datos de tenant.
DROP TABLE IF EXISTS core.locations;
DROP TABLE IF EXISTS core.areas;
DROP TABLE IF EXISTS core.warehouses;