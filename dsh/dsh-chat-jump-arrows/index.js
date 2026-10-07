/**
 * Host half of dsh-chat-jump-arrows.
 *
 * The whole feature lives in the browser: `./client.js` mounts two floating
 * chevrons into the frame-wide `shell.overlay` seat and walks the reader's own
 * sent messages through scroll-into-view. There is nothing for the Host to do —
 * no route, no command, no session state — so this half exists only because a
 * bundle entry mounted from `cordis.patch.yml` must resolve to a real plugin.
 *
 * Deliberately NOT declared in `inject`: an empty injection list means the node
 * activates immediately with no service dependency at all, so a Host-side
 * service regression can never keep the browser half out of the boot graph.
 */

const name = 'chat-jump-arrows'

function apply() {
  // Intentionally empty: the browser half owns the entire feature.
}

export { apply, name }
