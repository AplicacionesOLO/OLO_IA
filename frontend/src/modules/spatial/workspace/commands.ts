/**
 * COMMAND REGISTRY — paleta de comandos extensible.
 *
 * Cada comando tiene un id, label, categoria, shortcut opcional y handler.
 * La paleta busca por label con fuzzy matching. Los modulos registran
 * comandos sin conocer la paleta.
 */

export interface Command {
  id: string;
  label: string;
  category: string;
  /** Combo del shortcut (para mostrar en la paleta). */
  shortcut?: string;
  /** Handler que ejecuta el comando. */
  execute: () => void;
  /** Si el comando esta disponible en el contexto actual. */
  enabled?: boolean;
}

/**
 * Registry mutable. Los componentes registran comandos en mount y los
 * desregistran en unmount. La paleta lee el snapshot actual.
 */
class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command) {
    this.commands.set(command.id, command);
  }

  unregister(id: string) {
    this.commands.delete(id);
  }

  getAll(): Command[] {
    return [...this.commands.values()].filter((c) => c.enabled !== false);
  }

  search(query: string): Command[] {
    if (!query) return this.getAll();
    const q = query.toLowerCase();
    return this.getAll().filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }

  execute(id: string) {
    const cmd = this.commands.get(id);
    if (cmd && cmd.enabled !== false) cmd.execute();
  }
}

/** Singleton global. Los hooks lo consumen. */
export const commandRegistry = new CommandRegistry();
