import { type Context } from "koa";
import type Router from "@koa/router";
import { type IGameRegistry } from "../libs/game-registry/index.js";

// Listing games needs no logic, so this talks to the registry directly.
export class ApiGame {
	protected gameRegistry: IGameRegistry;

	constructor(gameRegistry: IGameRegistry) {
		this.gameRegistry = gameRegistry;
	}

	public registerRoutes(router: Router): void {
		/**
		 * @openapi
		 * /games:
		 *   get:
		 *     tags:
		 *       - Games
		 *     summary: List playable stories
		 *     description: Every story file found in the configured directory. No authentication.
		 *     responses:
		 *       200:
		 *         description: The games
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 games:
		 *                   type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       id:
		 *                         type: string
		 *                         example: zork1
		 *                       title:
		 *                         type: string
		 *                         example: "Zork I: The Great Underground Empire"
		 *                       story:
		 *                         type: object
		 *                         properties:
		 *                           zVersion:
		 *                             type: integer
		 *                             example: 3
		 *                           release:
		 *                             type: integer
		 *                             example: 88
		 *                           serial:
		 *                             type: string
		 *                             example: "840726"
		 *                           checksum:
		 *                             type: integer
		 */
		router.get("/games", this.getGames.bind(this));
	}

	private async getGames(ctx: Context): Promise<void> {
		ctx.body = { games: this.gameRegistry.list() };
	}
}
