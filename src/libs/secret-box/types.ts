export interface ISecretBox {
	encrypt: (plaintext: string) => string;
	decrypt: (sealed: string) => string;
}
