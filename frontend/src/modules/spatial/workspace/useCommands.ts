/**
 * USE COMMANDS — registra comandos del workspace en la paleta.
 *
 * Se llama desde el page-level component con los handlers actuales.
 * Los comandos se registran en mount y se limpian en unmount.
 */

import { useEffect } from 'react';
import { commandRegistry, type Command } from './commands';

export function useRegisterCommands(commands: Command[]) {
  useEffect(() => {
    for (const cmd of commands) {
      commandRegistry.register(cmd);
    }
    return () => {
      for (const cmd of commands) {
        commandRegistry.unregister(cmd.id);
      }
    };
  }, [commands]);
}
