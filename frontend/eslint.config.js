import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Desactivada a proposito: el patron "Provider + su hook en el mismo
      // archivo" es idiomatico en React y mantiene juntos el contexto y su
      // unico consumidor legitimo. El coste es perder fast-refresh en esos
      // archivos concretos, que es aceptable.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // El sistema de movimiento prohibe animar propiedades de layout: solo
      // transform, opacity y filter son compuestas por GPU.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "Property[key.name='animate'] ObjectExpression > Property[key.name=/^(width|height|top|left|right|bottom|margin|padding)$/]",
          message:
            'No animar propiedades de layout: provocan reflow en cada frame. Usa transform, opacity o filter.',
        },
      ],
    },
  },
);
