import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	prettierRecommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			'no-console': 'warn',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrors: 'none',
				},
			],
			'@typescript-eslint/naming-convention': [
				'error',
				{ selector: 'interface', format: ['PascalCase'] },
				{ selector: 'class', format: ['PascalCase'] },
				{ selector: 'property', format: ['camelCase'] },
				{ selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
				{ selector: 'function', format: ['camelCase'] },
				{ selector: 'classMethod', format: ['camelCase'] },
			],
		},
	},
)
