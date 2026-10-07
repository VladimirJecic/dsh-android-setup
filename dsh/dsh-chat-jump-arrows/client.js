/**
 * dsh-chat-jump-arrows — client half.
 *
 * Two floating chevrons on the right flank of the transcript that walk the
 * reader's OWN sent messages through scroll-into-view, one per tap:
 *
 *   ▲  previous message of mine (the nearest one above the reading line)
 *   ▼  next message of mine, and at the last one it falls through to the
 *      bottom of the transcript (which also re-arms DSH's follow-tail)
 *
 * Why this exists: on a phone a single agent turn can generate thousands of
 * pixels of process output, and the reader's own question — the thing they
 * actually asked — ends up far above the viewport with no hand-hold to get
 * back to it. DSH's own turn rail navigates turns (not questions), and its
 * stylesheet hides that rail outright on narrow viewports
 * (`@container (width<=900px) { .frame { display: none } }` in
 * ui-chat/TurnNavigator.module.css), which is exactly the device this plugin
 * is for. DSH also already ships a floating "to bottom" chevron; it is the
 * one-way half of this feature, so ▼ deliberately reuses the same landing
 * (the floor) instead of inventing a second bottom.
 *
 * Seat: `shell.overlay` — the sanctioned frame-wide floating layer
 * (dsh-client-ui-layout's AppFrame slots: kind 'list', scope 'root',
 * z-index 20, `pointer-events: none` with `> * { pointer-events: auto }`), the
 * one seat documented as "the additive seat for a frame-wide surface of your
 * own". Nothing in the chat is patched, so `npm install -g
 * @deepseek-ai/dsh@latest` cannot delete this feature.
 *
 * How the transcript is read, without importing any DSH internal:
 *   • the scrollport is `[data-conversation-scroll]` (ConversationRoot's
 *     `.scrollBody`, `overflow-y: auto`) — the chat's own inner `.scroll` is
 *     `overflow: visible` inside it, so this is THE scroller;
 *   • a message of mine is a row carrying `data-chat-flow-kind="user"` or
 *     `"steering"` (steering = what I sent while the agent was busy). Both are
 *     set by ui-chat's ChatView on the outermost `.flowItem` of the row, next
 *     to `data-chat-anchor-key`;
 *   • "which of my messages am I reading" is decided by a reading line a
 *     fraction down the scrollport, not by pixel equality, so a row that
 *     merely happens to sit 3px off the top does not make ▲ jump nowhere.
 *
 * Loader contract: DSH's browser module loader is NOT plain ESM — the bundle
 * registers itself through `window.__ModuleLoader__.load({id, factory})`, with
 * `id` equal to the package name. A raw ESM file loads as a script but never
 * registers, and the loader then refuses to boot ANY plugin. No bundler here:
 * the file has one dependency (react, supplied by the loader's `require`), so
 * it is hand-wrapped exactly like dsh-composer-extras.
 */
window.__ModuleLoader__.load({
	id: "dsh-chat-jump-arrows",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var react = require("react");
		var createElement = react.createElement;
		var useEffect = react.useEffect;
		var useRef = react.useRef;
		var useState = react.useState;

		/** Frame-wide floating seat owned by dsh-client-ui-layout's AppFrame. */
		var SLOT_NAME = "shell.overlay";
		/** Registration id inside that list slot. */
		var SLOT_ID = "chat-jump-arrows";

		/** The Conversation's own scrollport (`.scrollBody`, `overflow-y: auto`). */
		var SCROLL_SELECTOR = "[data-conversation-scroll]";
		/**
		 * The reader's own input rows. `user` is an ordinary prompt, `steering`
		 * is one sent while the agent was still working; both are mine, both are
		 * outside a Turn's collapsed process, so both belong in the walk.
		 */
		var MY_ROW_SELECTOR =
			'[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]';
		/** A row inside a collapsed process group is not a prompt of mine. */
		var FLOW_KIND_ATTR = "data-chat-flow-kind";

		/** Where a landed row's top ends up, measured from the scrollport top. */
		var LANDING_OFFSET_PX = 12;
		/**
		 * The band that counts as "parked at the top".
		 *
		 * A row is the row you are ON when its top sits within this band; that is
		 * what makes ▲ step to the one above it. A row whose top is above the band
		 * has been scrolled past, so ▲ re-aligns that same row instead — which is
		 * how one more tap recovers a row that DSH's position compensation nudged.
		 * Deliberately measured from the row's OWN top and not from a reading line
		 * further down: a one-line prompt is shorter than any such line, and a deep
		 * line would make it "never parked", pinning ▲ on the same row forever.
		 */
		var PARKED_LINE_PX = 40;
		var PARKED_BAND_TOP_PX = -8;
		/** Distance from the floor still counted as "at the bottom". */
		var AT_BOTTOM_SLACK_PX = 4;
		/** Re-assert a landing only when it drifted by more than this. */
		var LANDING_DRIFT_PX = 40;
		/** When the landing is verified, relative to the tap. */
		var LANDING_CHECKS_MS = [260, 620, 1150];
		/** Cheap safety net: the scrollport can be replaced while a session loads. */
		var RESCAN_MS = 1000;

		var BADGE_TEXT_FONT = 10;

		/** requestAnimationFrame with a timeout fallback for hidden tabs. */
		function requestFrame(fn) {
			if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
				return window.requestAnimationFrame(fn);
			}
			return window.setTimeout(fn, 16);
		}

		function cancelFrame(id) {
			if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
				window.cancelAnimationFrame(id);
				return;
			}
			window.clearTimeout(id);
		}

		/** Honour the OS "reduce motion" switch; a jump is a jump either way. */
		function preferredBehavior() {
			if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
				try {
					if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "auto";
				} catch (error) {
					// A malformed media query must never break a jump.
				}
			}
			return "smooth";
		}

		/**
		 * The scrollport that is actually showing a transcript right now.
		 *
		 * There can be more than one `[data-conversation-scroll]` in the frame
		 * (an embedded Conversation, a subagent's sidebar chat). The one that
		 * carries the reader's own rows wins; otherwise the first laid-out one is
		 * returned so an empty session still resolves a container.
		 * @param doc - document to search.
		 * @returns the scrollport, or null when no Conversation is mounted.
		 */
		function findScrollport(doc) {
			var found = doc.querySelectorAll(SCROLL_SELECTOR);
			var fallback = null;
			for (var i = 0; i < found.length; i++) {
				var candidate = found[i];
				var rect = candidate.getBoundingClientRect();
				if (rect.height <= 0 || rect.width <= 0) continue;
				if (fallback === null) fallback = candidate;
				if (candidate.querySelector(MY_ROW_SELECTOR) !== null) return candidate;
			}
			return fallback;
		}

		/**
		 * The reader's own rows inside one transcript, in document order.
		 *
		 * Hidden rows are dropped (a collapsed process group hides its members)
		 * and so are rows nested inside another flow row: ui-chat can nest an
		 * anchor row inside `[data-step-process-content]`, and the outer row is
		 * the one that actually moves when the transcript scrolls.
		 * @param container - the transcript scrollport.
		 * @returns my rows, outermost and visible only.
		 */
		function collectMyRows(container) {
			var rows = [];
			var found = container.querySelectorAll(MY_ROW_SELECTOR);
			for (var i = 0; i < found.length; i++) {
				var row = found[i];
				if (typeof row.closest === "function" && row.closest("[hidden]") !== null) continue;
				var parent = row.parentElement;
				var enclosing =
					parent !== null && parent !== undefined && typeof parent.closest === "function"
						? parent.closest("[" + FLOW_KIND_ATTR + "]")
						: null;
				if (enclosing !== null && enclosing !== undefined && container.contains(enclosing)) continue;
				rows.push(row);
			}
			return rows;
		}

		/** The row you are on, or -1 when every one of your rows is still below the band. */
		function activeRowIndex(rows, viewport) {
			var line = viewport.top + PARKED_LINE_PX;
			var index = -1;
			for (var i = 0; i < rows.length; i++) {
				if (rows[i].getBoundingClientRect().top <= line) index = i;
			}
			return index;
		}

		/** Whether the row at `index` is the one parked at the top, not one scrolled past. */
		function isParked(rows, index, viewport) {
			if (index < 0) return false;
			return rows[index].getBoundingClientRect().top >= viewport.top + PARKED_BAND_TOP_PX;
		}

		/** Whether the scrollport is at (or within a hair of) its floor. */
		function isAtBottom(container) {
			return (
				container.scrollHeight - container.clientHeight - container.scrollTop <= AT_BOTTOM_SLACK_PX
			);
		}

		/** Position the scrollport, honouring reduce-motion and old WebViews. */
		function scrollContainerTo(container, top, instant) {
			var max = Math.max(0, container.scrollHeight - container.clientHeight);
			var clamped = Math.max(0, Math.min(max, top));
			if (typeof container.scrollTo === "function") {
				try {
					container.scrollTo({ top: clamped, behavior: instant === true ? "auto" : preferredBehavior() });
					return;
				} catch (error) {
					// Older engines reject the options object; fall through to scrollTop.
				}
			}
			container.scrollTop = clamped;
		}

		/** Land one row at the top of the reading area. */
		function scrollRowToTop(container, row, instant) {
			var viewport = container.getBoundingClientRect();
			var rect = row.getBoundingClientRect();
			scrollContainerTo(container, container.scrollTop + (rect.top - viewport.top) - LANDING_OFFSET_PX, instant);
		}

		/** Land at the floor; DSH re-arms follow-tail on the resulting scroll. */
		function scrollToFloor(container, instant) {
			scrollContainerTo(container, container.scrollHeight, instant);
		}

		/**
		 * Re-assert one landing after DSH's own reading-position compensation has
		 * had its say (history paging inserts rows ABOVE the viewport and rewrites
		 * scrollTop to keep the old anchor still). Checks only fire once the
		 * scrollport has stopped moving, and any real gesture cancels them, so
		 * this can never fight the reader's thumb.
		 * @param container - the transcript scrollport.
		 * @param row - the row that was supposed to land.
		 */
		function assertLanding(container, row) {
			var previous = container.scrollTop;
			var cancelled = false;
			var timers = [];
			var doc = container.ownerDocument || document;

			function stop() {
				cancelled = true;
				for (var i = 0; i < timers.length; i++) window.clearTimeout(timers[i]);
				timers.length = 0;
				unbind();
			}

			function onGesture() {
				stop();
			}

			function bind() {
				if (typeof doc.addEventListener !== "function") return;
				doc.addEventListener("touchstart", onGesture, { passive: true, once: true });
				doc.addEventListener("wheel", onGesture, { passive: true, once: true });
				doc.addEventListener("pointerdown", onGesture, { passive: true, once: true });
			}

			function unbind() {
				if (typeof doc.removeEventListener !== "function") return;
				doc.removeEventListener("touchstart", onGesture);
				doc.removeEventListener("wheel", onGesture);
				doc.removeEventListener("pointerdown", onGesture);
			}

			function check() {
				if (cancelled) return;
				if (container.isConnected === false) return stop();
				if (typeof container.contains === "function" && !container.contains(row)) return stop();
				var current = container.scrollTop;
				var moving = Math.abs(current - previous) > 1;
				previous = current;
				if (moving) return;
				var viewport = container.getBoundingClientRect();
				var rect = row.getBoundingClientRect();
				var drift = rect.top - viewport.top - LANDING_OFFSET_PX;
				if (Math.abs(drift) > LANDING_DRIFT_PX) scrollRowToTop(container, row, true);
				stop();
			}

			bind();
			for (var i = 0; i < LANDING_CHECKS_MS.length; i++) {
				timers.push(window.setTimeout(check, LANDING_CHECKS_MS[i]));
			}
		}

		/** Land on one of my rows and then defend the landing. */
		function landOnRow(container, row) {
			scrollRowToTop(container, row, false);
			assertLanding(container, row);
		}

		/** ▲ — previous prompt of mine; re-align the one we are already past. */
		function jumpToPrevious(container) {
			var rows = collectMyRows(container);
			if (rows.length === 0) return;
			var viewport = container.getBoundingClientRect();
			var index = activeRowIndex(rows, viewport);
			if (index < 0) return;
			var target = isParked(rows, index, viewport) ? index - 1 : index;
			if (target < 0) return;
			landOnRow(container, rows[target]);
		}

		/** ▼ — next prompt of mine; past the last one, fall through to the floor. */
		function jumpToNext(container) {
			var rows = collectMyRows(container);
			if (rows.length === 0) return;
			var viewport = container.getBoundingClientRect();
			var index = activeRowIndex(rows, viewport);
			if (index < 0) {
				if (isAtBottom(container)) return;
				landOnRow(container, rows[0]);
				return;
			}
			if (index + 1 < rows.length) {
				landOnRow(container, rows[index + 1]);
				return;
			}
			if (isAtBottom(container)) return;
			scrollToFloor(container, false);
		}

		/** Everything the overlay renders from, recomputed off live geometry. */
		var HIDDEN_STATE = {
			visible: false,
			count: 0,
			index: -1,
			canUp: false,
			canDown: false,
			nextIsBottom: false,
			right: 8,
			centerY: 0,
			key: "hidden"
		};

		/**
		 * Read one transcript into render state.
		 * @param container - the transcript scrollport, or null.
		 * @returns the state, with a `key` cheap enough to diff for equality.
		 */
		function computeState(container) {
			if (container === null || container === undefined) return HIDDEN_STATE;
			var rows = collectMyRows(container);
			if (rows.length === 0) return HIDDEN_STATE;
			var viewport = container.getBoundingClientRect();
			if (!(viewport.height > 0)) return HIDDEN_STATE;

			var index = activeRowIndex(rows, viewport);
			var bottom = isAtBottom(container);
			var canUp;
			var canDown;
			var nextIsBottom = false;
			if (index < 0) {
				canUp = false;
				canDown = !bottom;
			} else {
				canUp = isParked(rows, index, viewport) ? index > 0 : true;
				if (index + 1 < rows.length) {
					canDown = true;
				} else {
					nextIsBottom = true;
					canDown = !bottom;
				}
			}

			var width = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : viewport.right;
			var right = Math.max(8, Math.round(width - viewport.right) + 8);
			var centerY = Math.round(viewport.top + viewport.height * 0.46);

			return {
				visible: true,
				count: rows.length,
				index: index,
				canUp: canUp,
				canDown: canDown,
				nextIsBottom: nextIsBottom,
				right: right,
				centerY: centerY,
				key: [rows.length, index, canUp ? 1 : 0, canDown ? 1 : 0, right, centerY].join("|")
			};
		}

		/** Inline chevron; drawn inline so the plugin needs no icon package. */
		function chevron(up) {
			return createElement(
				"svg",
				{
					width: 20,
					height: 20,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 2.2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": true,
					focusable: false
				},
				createElement("polyline", { points: up ? "6 14.5 12 8.5 18 14.5" : "6 9.5 12 15.5 18 9.5" })
			);
		}

		var ARROW_BUTTON_STYLE = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: 34,
			height: 34,
			padding: 0,
			border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.32))",
			borderRadius: 100,
			color: "var(--dsw-alias-label-primary, inherit)",
			background: "var(--dsw-alias-button-floating-fill, rgba(127,127,127,0.18))",
			boxShadow: "var(--dsw-elevation-panel, 0 2px 10px rgba(0,0,0,0.28))",
			// The strip sits over the transcript's right edge (a phone has no room
			// outside the text column), so blur what is underneath instead of
			// letting glyphs fight the chevron.
			backdropFilter: "blur(6px)",
			WebkitBackdropFilter: "blur(6px)",
			touchAction: "manipulation",
			WebkitTapHighlightColor: "transparent",
			fontFamily: "inherit"
		};

		/**
		 * One arrow. `disabled` rather than unmounted, so the pair never shifts
		 * under the thumb and the direction that still works stays where it was.
		 */
		function arrowButton(up, label, disabled, onPress) {
			var style = {};
			for (var key in ARROW_BUTTON_STYLE) style[key] = ARROW_BUTTON_STYLE[key];
			style.opacity = disabled ? 0.35 : 1;
			style.cursor = disabled ? "default" : "pointer";
			return createElement(
				"button",
				{
					type: "button",
					title: label,
					"aria-label": label,
					disabled: disabled,
					"data-chat-jump-arrow": up ? "up" : "down",
					onClick: function (event) {
						if (event !== undefined && event !== null) {
							if (typeof event.preventDefault === "function") event.preventDefault();
							if (typeof event.stopPropagation === "function") event.stopPropagation();
						}
						if (disabled) return;
						var container = findScrollport(document);
						if (container === null) return;
						onPress(container);
					},
					onPointerDown: function (event) {
						// Never let the tap be read as a transcript gesture.
						if (event !== undefined && event !== null && typeof event.stopPropagation === "function") {
							event.stopPropagation();
						}
					},
					style: style
				},
				chevron(up)
			);
		}

		/**
		 * The floating control. Root-scoped and session-agnostic on purpose: it
		 * reads whatever transcript is on screen, so switching sessions needs no
		 * lifecycle of its own beyond the observers below.
		 */
		function JumpArrows() {
			var pair = useState(HIDDEN_STATE);
			var state = pair[0];
			var setState = pair[1];
			var lastKey = useRef(HIDDEN_STATE.key);

			useEffect(function () {
				var live = true;
				var frame = 0;
				var observer = null;
				var resizeObserver = null;
				var bound = null;
				var interval = 0;

				function publish(next) {
					if (lastKey.current === next.key) return;
					lastKey.current = next.key;
					setState(next);
				}

				function scan() {
					if (!live) return;
					var container = findScrollport(document);
					if (container !== bound) {
						unbind();
						if (container !== null) bind(container);
					}
					publish(computeState(container));
				}

				function schedule() {
					if (!live || frame !== 0) return;
					frame = requestFrame(function () {
						frame = 0;
						scan();
					});
				}

				function bind(container) {
					bound = container;
					container.addEventListener("scroll", schedule, { passive: true, capture: true });
					if (typeof MutationObserver === "function") {
						observer = new MutationObserver(schedule);
						observer.observe(container, { childList: true, subtree: true });
					}
					// The sidebar/rightbar can resize the chat without a window
					// resize and without a child mutation; the parent's own box
					// changing is the only signal for the arrows' anchor edge.
					if (typeof ResizeObserver === "function") {
						resizeObserver = new ResizeObserver(schedule);
						resizeObserver.observe(container);
					}
				}

				function unbind() {
					if (bound !== null) {
						bound.removeEventListener("scroll", schedule, true);
						bound = null;
					}
					if (observer !== null) {
						observer.disconnect();
						observer = null;
					}
					if (resizeObserver !== null) {
						resizeObserver.disconnect();
						resizeObserver = null;
					}
				}

				scan();
				interval = window.setInterval(scan, RESCAN_MS);
				window.addEventListener("resize", schedule);
				window.addEventListener("orientationchange", schedule);
				return function () {
					live = false;
					unbind();
					window.clearInterval(interval);
					window.removeEventListener("resize", schedule);
					window.removeEventListener("orientationchange", schedule);
					if (frame !== 0) cancelFrame(frame);
				};
			}, []);

			if (!state.visible) return null;

			var position = (state.index >= 0 ? state.index + 1 : 0) + "/" + state.count;
			var upLabel = state.canUp
				? "Idi na prethodnu moju poruku (" + position + ")"
				: "Nema moje poruke iznad (" + position + ")";
			var downLabel = state.nextIsBottom
				? "Idi na dno razgovora"
				: "Idi na sledeću moju poruku (" + position + ")";

			return createElement(
				"div",
				{
					"data-chat-jump-arrows": "root",
					style: {
						position: "fixed",
						right: state.right,
						top: state.centerY,
						transform: "translateY(-50%)",
						zIndex: 21,
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 6,
						pointerEvents: "auto"
					}
				},
				arrowButton(true, upLabel, !state.canUp, jumpToPrevious),
				createElement(
					"span",
					{
						"aria-hidden": true,
						style: {
							fontSize: BADGE_TEXT_FONT,
							lineHeight: 1,
							padding: "3px 4px",
							borderRadius: 6,
							color: "var(--dsw-alias-label-secondary, #888)",
							background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))",
							fontVariantNumeric: "tabular-nums"
						}
					},
					position
				),
				arrowButton(false, downLabel, !state.canDown, jumpToNext)
			);
		}

		function apply(ctx) {
			ctx.slots.inject(SLOT_NAME, function () {
				return ctx.slots.register(
					{
						name: SLOT_NAME,
						id: SLOT_ID,
						order: 40
					},
					JumpArrows
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		/** Internal seams for the offline harness in ~/dsh/tests. */
		exports.__test__ = {
			computeState: computeState,
			collectMyRows: collectMyRows,
			findScrollport: findScrollport,
			activeRowIndex: activeRowIndex,
			isParked: isParked,
			isAtBottom: isAtBottom,
			jumpToPrevious: jumpToPrevious,
			jumpToNext: jumpToNext
		};
		return module.exports;
	}
});
