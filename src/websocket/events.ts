/**
 * Type-safe WebSocket event name constants.
 *
 * Use these everywhere instead of magic strings so typos
 * are caught at compile time, not at runtime.
 */
export const WS_EVENTS = {
  /** Emitted when the user's profile data changes */
  USER_UPDATED: 'user:updated',

  /** Generic server notification pushed to a specific user */
  NOTIFICATION: 'notification',

  /** Server → client: pet says something (e.g. hunger reminder) — show in dialog on all pages */
  PET_DIALOG: 'pet:dialog',
  /** Client → server: report pet behavior state change. */
  PET_BEHAVIOR: 'pet:behavior',
  /** Server → client: force behavior correction (e.g. pet stuck sleeping). */
  PET_BEHAVIOR_SYNC: 'pet:behavior_sync',
  /** Server → client: authoritative pet state (col, row, behavior, target). */
  PET_STATE_UPDATE: 'pet:state_update',
  /** Client → server: walk/eat animation done; server advances to next state. */
  PET_ACTION_COMPLETE: 'pet:action_complete',
  /** Server → client: pet stats updated (e.g. after feeding). */
  PET_UPDATED: 'pet:updated',

  // ─── Game Events (client → server) ────────────────────────────────────
  GAME_LOAD: 'game:load',
  GAME_PLACE_ITEM: 'game:place_item',
  GAME_REMOVE_ITEM: 'game:remove_item',
  GAME_HARVEST: 'game:harvest',
  /** Client → server: shake a tree to harvest fruit or other drops. */
  GAME_SHAKE_TREE: 'game:shake_tree',
  GAME_RENAME_FARM: 'game:rename_farm',
  GAME_MOVE_ITEM: 'game:move_item',
  GAME_WATER_TILE: 'game:water_tile',
  GAME_PURCHASE: 'game:purchase',
  GAME_SELL: 'game:sell',
  GAME_SELL_BATCH: 'game:sell_batch',
  GAME_SET_EQUIPPED: 'game:set_equipped',
  /** Client → server: batched crop ops (plant/water/harvest). */
  GAME_CROP_BATCH: 'game:crop_batch',

  // ─── Game Events (server → client) ────────────────────────────────────
  GAME_SNAPSHOT: 'game:snapshot',
  GAME_STATE_UPDATE: 'game:state_update',
  GAME_ERROR: 'game:error',
  /** Broadcast to ALL clients when an admin modifies item definitions. */
  GAME_ITEM_DEFS_UPDATED: 'game:item_defs_updated',

  // ─── User Events ───────────────────────────────────────────────────
  /** Client → server: set the user's IANA timezone for time-of-day bug filtering. */
  USER_SET_TIMEZONE: 'user:set_timezone',

  // ─── Bug Events ─────────────────────────────────────────────────────
  /** Server → client: a new bug has appeared on the farm. */
  BUG_SPAWN: 'bug:spawn',
  /** Client → server: player caught a bug with the net tool. */
  BUG_CATCH: 'bug:catch',
  /** Server → client: catch result with size, gems, label. */
  BUG_CAUGHT: 'bug:caught',
  /** Server → client: a bug has despawned (timed out). */
  BUG_DESPAWN: 'bug:despawn',

  // ─── Balloon Events ───────────────────────────────────────────────────
  /** Server → client: a new balloon has appeared on the farm. */
  BALLOON_SPAWN: 'balloon:spawn',
  /** Client → server: player popped a balloon. */
  BALLOON_POP: 'balloon:pop',
  /** Server → client: pop result with item, label, qty. */
  BALLOON_POPPED: 'balloon:popped',
  /** Server → client: a balloon has despawned (timed out). */
  BALLOON_DESPAWN: 'balloon:despawn',

  // ─── Fossil Events ───────────────────────────────────────────────────
  /** Client → server: player wants to dig a fossil (anchorId of placed fossil_hole). */
  FOSSIL_DIG: 'fossil:dig',
  /** Server → client: dig result with item, label, qty. */
  FOSSIL_DUG: 'fossil:dug',

  // ─── Scenery Events ──────────────────────────────────────────────────
  /** Server → all clients: admin re-baked scenery for a farm size. */
  SCENERY_UPDATED: 'scenery:updated',

  // ─── Quest Events ─────────────────────────────────────────────────
  /** Client → server: complete a quest. */
  QUEST_COMPLETE: 'quest:complete',
  /** Server → client: quest completed, full snapshot follows. */
  QUEST_COMPLETED: 'quest:completed',
  /** Server → client: show a quest dialog sequence. */
  QUEST_DIALOG: 'quest:dialog',
  /** Client → server: try to activate quests by talking to NPC. */
  QUEST_ACTIVATE_BY_NPC: 'quest:activate_by_npc',
  /** Client → server: try to activate quests by entering a scene. */
  QUEST_ACTIVATE_BY_SCENE: 'quest:activate_by_scene',
  /** Server → client: quests activated by trigger (includes start dialogs). */
  QUEST_ACTIVATED: 'quest:activated',
  /** Client → server: user finished NPC dialog (for talk_to_npc requirement). */
  QUEST_NPC_DIALOG_DISMISSED: 'quest:npc_dialog_dismissed',
  /** Client → server: user opened a modal (for open_modal requirement). */
  QUEST_MODAL_OPENED: 'quest:modal_opened',

  // ─── Cooking Events ──────────────────────────────────────────────────
  /** Client → server: attempt to cook with selected ingredients. */
  GAME_COOK: 'game:cook',
  /** Server → client: result of a cooking attempt. */
  GAME_COOK_RESULT: 'game:cook_result',
  /** Client → server: pet eats a placed food item. */
  GAME_FEED_PET: 'game:feed_pet',
  /** Client → server: add food items to a food dish. */
  GAME_ADD_TO_FOOD_DISH: 'game:add_to_food_dish',
  /** Client → server: pet consumes from food dish (server pops queue and feeds). */
  GAME_CONSUME_FROM_FOOD_DISH: 'game:consume_from_food_dish',
  /** Client → server: collect water from a well (payload: { wellSlug }). */
  GAME_COLLECT_WATER: 'game:collect_water',
  /** Server → client: water collection result (waterQty, nextAvailableAt). */
  GAME_COLLECT_WATER_RESULT: 'game:collect_water_result',

  // ─── Crafting Events ─────────────────────────────────────────────────
  /** Client → server: attempt to craft with selected materials. */
  GAME_CRAFT: 'game:craft',
  /** Server → client: result of a crafting attempt. */
  GAME_CRAFT_RESULT: 'game:craft_result',

  // ─── Multiplayer Events ────────────────────────────────────────────
  /** Client → server: join a multiplayer scene. */
  MP_JOIN: 'mp:join',
  /** Server → client: successfully joined, includes player list + spawn pos. */
  MP_JOINED: 'mp:joined',
  /** Client → server: leave current multiplayer scene. */
  MP_LEAVE: 'mp:leave',
  /** Server → room: a player joined the instance. */
  MP_PLAYER_JOINED: 'mp:player_joined',
  /** Server → room: a player left the instance. */
  MP_PLAYER_LEFT: 'mp:player_left',
  /** Client → server: position update. */
  MP_MOVE: 'mp:move',
  /** Server → room: a player moved (excluding sender). */
  MP_PLAYER_MOVED: 'mp:player_moved',
  /** Client → server: send a chat message. */
  MP_CHAT: 'mp:chat',
  /** Server → room: a chat message was sent. */
  MP_CHAT_MESSAGE: 'mp:chat_message',
  /** Client → server: change active pose/expression. */
  MP_POSE: 'mp:pose',
  /** Server → room: a player changed their pose. */
  MP_PLAYER_POSE: 'mp:player_pose',
  /** Server → room: player changed equipped items (handTool, bobber, chair). */
  MP_PLAYER_EQUIPPED: 'mp:player_equipped',

  // ─── Fishing Events ─────────────────────────────────────────────────────
  /** Client → server: cast fishing line at (col, row). */
  MP_FISH_CAST: 'mp:fish_cast',
  /** Server → client: fish bit — open mini-game. */
  MP_FISH_BITE: 'mp:fish_bite',
  /** Server → room: player has fish on line (reeling in mini-game). */
  MP_FISH_REELING: 'mp:fish_reeling',
  /** Client → server: mini-game result (passed/failed). */
  MP_FISH_RESULT: 'mp:fish_result',
  /** Client → server: cancel fishing (e.g. user closed modal). */
  MP_FISH_CANCEL: 'mp:fish_cancel',
  /** Server → room: player caught a fish (result bubble). */
  MP_FISH_CAUGHT: 'mp:fish_caught',
  /** Server → room: player failed the mini-game. */
  MP_FISH_FAILED: 'mp:fish_failed',
  /** Server → room: player started fishing at (col, row). */
  MP_FISH_STARTED: 'mp:fish_started',
  /** Server → room: player canceled fishing (recast or leave). */
  MP_FISH_CANCELED: 'mp:fish_canceled',
} as const;

/** Union type of all valid event names */
export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
