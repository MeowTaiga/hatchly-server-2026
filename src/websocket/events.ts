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
  /** Client → server: chop a farm tree with an axe (3 wood / tree / day). */
  GAME_CHOP_TREE: 'game:chop_tree',
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
  /** Client → server: start a Spirit Snatch round (hourly, server-authored). */
  GAME_SPIRIT_SNATCH_START: 'game:spirit_snatch_start',
  /** Server → client: round payload or cooldown. */
  GAME_SPIRIT_SNATCH_START_RESULT: 'game:spirit_snatch_start_result',
  /** Client → server: finish a Spirit Snatch round with catch-zone taps. */
  GAME_SPIRIT_SNATCH: 'game:spirit_snatch',
  /** Server → client: Spirit Snatch result (score + candy awarded). */
  GAME_SPIRIT_SNATCH_RESULT: 'game:spirit_snatch_result',
  /** Server → client: a balloon has despawned (timed out). */
  BALLOON_DESPAWN: 'balloon:despawn',

  // ─── Fossil Events ───────────────────────────────────────────────────
  /** Client → server: player wants to dig a fossil (anchorId of placed fossil_hole). */
  FOSSIL_DIG: 'fossil:dig',
  /** Server → client: dig result with item, label, qty. */
  FOSSIL_DUG: 'fossil:dug',

  // ─── Ground pickup Events ────────────────────────────────────────────
  /** Client → server: pick up a daily ground item (stone/stick). */
  GROUND_PICKUP: 'ground:pickup',
  /** Server → client: pickup result with item, label, qty. */
  GROUND_PICKED_UP: 'ground:picked_up',

  // ─── Mining Events ───────────────────────────────────────────────────
  /** Client → server: start mining a scene ore tile (opens minigame). */
  MINE_ORE_BEGIN: 'mine:ore_begin',
  /** Server → client: vein info + tap/time for the mash minigame. */
  MINE_ORE_READY: 'mine:ore_ready',
  /** Client → server: finish the mash minigame. */
  MINE_ORE_COMPLETE: 'mine:ore_complete',
  /** Client → server: closed the minigame without finishing. */
  MINE_ORE_CANCEL: 'mine:ore_cancel',
  /** Server → client: mining result with item, label, qty. */
  MINE_ORE_RESULT: 'mine:ore_result',

  // ─── Scenery Events ──────────────────────────────────────────────────
  /** Server → all clients: admin re-baked scenery for a farm size. */
  SCENERY_UPDATED: 'scenery:updated',

  // ─── Quest Events ─────────────────────────────────────────────────
  // All quest results come back on GAME_STATE_UPDATE, which carries the quest
  // list, the upgrade flag, any completions to celebrate and any dialogs to
  // show. These are the client's four ways of reporting a quest-relevant act.
  /** Client → server: turn in a quest the player completed deliberately. */
  QUEST_COMPLETE: 'quest:complete',
  /** Client → server: the player finished talking to an NPC. */
  QUEST_TALK_TO_NPC: 'quest:talk_to_npc',
  /** Client → server: the player entered a scene. */
  QUEST_ENTER_SCENE: 'quest:enter_scene',
  /** Client → server: the player opened a modal or screen. */
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
  /** Client → server: craft a known recipe by recipeId (must be learned). */
  GAME_CRAFT: 'game:craft',
  /** Server → client: result of a crafting attempt. */
  GAME_CRAFT_RESULT: 'game:craft_result',
  /** Client → server: smelt a recipe at the smelter. */
  GAME_SMELT: 'game:smelt',
  /** Server → client: result of a smelting attempt. */
  GAME_SMELT_RESULT: 'game:smelt_result',
  /** Client → server: consume a recipe scroll to learn it permanently. */
  GAME_LEARN_RECIPE: 'game:learn_recipe',
  /** Server → client: recipe learned (or error via GAME_ERROR). */
  GAME_LEARN_RECIPE_RESULT: 'game:learn_recipe_result',

  /** Client → server: move items from backpack into farm storage. */
  GAME_STORAGE_DEPOSIT: 'game:storage_deposit',
  /** Client → server: move items from storage into backpack. */
  GAME_STORAGE_WITHDRAW: 'game:storage_withdraw',

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
  /** Server → room: player mined ore (result bubble). */
  MP_ORE_MINED: 'mp:ore_mined',

  /** Server → room: player failed the mini-game. */
  MP_FISH_FAILED: 'mp:fish_failed',
  /** Server → room: player started fishing at (col, row). */
  MP_FISH_STARTED: 'mp:fish_started',
  /** Server → room: player canceled fishing (recast or leave). */
  MP_FISH_CANCELED: 'mp:fish_canceled',

  // ─── Trade Events ───────────────────────────────────────────────────────
  /** Client → server: request a trade with another player in the same instance. */
  MP_TRADE_REQUEST: 'mp:trade_request',
  /** Server → recipient: incoming trade request. */
  MP_TRADE_REQUESTED: 'mp:trade_requested',
  /** Client → server: accept a pending trade request. */
  MP_TRADE_ACCEPT: 'mp:trade_accept',
  /** Client → server: decline a pending trade request. */
  MP_TRADE_DECLINE: 'mp:trade_decline',
  /** Server → initiator: recipient declined. */
  MP_TRADE_DECLINED: 'mp:trade_declined',
  /** Server → both: trade window is open. */
  MP_TRADE_OPEN: 'mp:trade_open',
  /** Client → server: replace your offer (items are escrowed from inventory). */
  MP_TRADE_UPDATE: 'mp:trade_update',
  /** Server → both: authoritative trade snapshot. */
  MP_TRADE_STATE: 'mp:trade_state',
  /** Client → server: mark yourself ready (both ready → complete). */
  MP_TRADE_CONFIRM: 'mp:trade_confirm',
  /** Client → server: cancel an open / pending trade. */
  MP_TRADE_CANCEL: 'mp:trade_cancel',
  /** Server → other party: trade cancelled. */
  MP_TRADE_CANCELLED: 'mp:trade_cancelled',
  /** Server → both: trade completed successfully. */
  MP_TRADE_COMPLETE: 'mp:trade_complete',
  /** Server → actor: trade error. */
  MP_TRADE_ERROR: 'mp:trade_error',
} as const;

/** Union type of all valid event names */
export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
