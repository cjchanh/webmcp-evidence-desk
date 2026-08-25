/**
 * Shared mocks for webmcp-layer tests.
 */

import { applyAgentAction, createBoard } from '../../src/domain/board.ts'
import type {
  BoardState,
  Exhibit,
  Stance
} from '../../src/domain/types.ts'
import type {
  ModelContextLike,
  ToolContext,
  WebMcpToolDefinition
} from '../../src/webmcp/register.ts'

export interface MockModelContext {
  mc: ModelContextLike
  registered: WebMcpToolDefinition[]
}

/**
 * Mock document.modelContext. `failFor` maps tool name -> DOMException name
 * to simulate real registration failures (e.g. InvalidStateError duplicates).
 */
export function makeMockModelContext(
  failFor: Record<string, string> = {}
): MockModelContext {
  const registered: WebMcpToolDefinition[] = []
  return {
    registered,
    mc: {
      async registerTool(tool: WebMcpToolDefinition): Promise<void> {
        const failureName = failFor[tool.name]
        if (failureName) {
          throw new DOMException(`registration failed for ${tool.name}`, failureName)
        }
        registered.push(tool)
      }
    }
  }
}

export interface MockApp {
  ctx: ToolContext
  board(): BoardState
}

/** ToolContext wired to fixture exhibits + a live in-test board. */
export function makeToolContext(exhibits: Exhibit[]): MockApp {
  let board = createBoard()
  return {
    board: () => board,
    ctx: {
      exhibits: () => exhibits,
      addToBoard(exhibitId: string, stance: Stance) {
        const result = applyAgentAction(board, {
          action: 'add',
          exhibit_id: exhibitId,
          stance
        })
        if (result.ok) board = result.board
        return result
      }
    }
  }
}
