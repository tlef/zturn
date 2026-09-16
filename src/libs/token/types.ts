export interface ITokenService {
	generateSessionId: () => string;
	generateToken: () => string;
	generateSeed: () => number;
	hashToken: (token: string) => string;
	verifyToken: (token: string, hash: string) => boolean;
}
