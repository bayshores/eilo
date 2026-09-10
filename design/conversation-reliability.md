# Conversation reliability and useful support

September 10, 2026. Implemented in the existing human/event adapters; inbox tools remain a separate milestone.

## Reported failure

An ordinary conversational reply was replaced with a task-change error because the model echoed a different request ID. The native message was correctly tied to the current user turn, and the proposed reply contained no task operations. Requiring the model to reproduce transport identity made valid chat unnecessarily fragile.

The earlier responses also treated reluctance as a request for work instructions and overstated the usefulness of external viewing-history records. The policy had already prohibited unsolicited planning, but did not give sufficient guidance for ordinary resistance and capability questions.

## Changes

- The model proposes only kind, reply and operations. The native driver attaches the caller's actual request ID and task revision after identifying the current native rows. Legacy envelopes remain readable, but model-generated correlation fields are not authoritative.
- The server still checks the transport receipt, the current task revision and every operation. Recovery requires matching request/revision metadata on the native user/proposal pair. Invalid, duplicate-key and inconsistent proposals do not change tasks.
- Task-change acknowledgments come from committed operations, so update proposals may have empty reply text. Chat and clarification still require usable text. Live chat previews are tied to the active subprocess/request; update acknowledgments remain hidden until commit.
- Exceptional reply failures no longer ask the user to clarify an imaginary task edit or manage task controls.
- Human/event instructions treat resistance as conversational feedback, preserve the user's methods, and avoid commands to close apps or perform solution steps. Criticism does not imply canceling a goal or withdrawing all support. Explicitly requested briefs/prioritization remain welcome.
- Current source limits are stated honestly: the human lane has no measured activity totals, email tools or Calendar event content. It must not claim an inbox/calendar investigation occurred or fabricate usage totals.

## Verification

112 Python tests passed, including new cases for wrong model-written IDs, unchanged transport identity checks, stale task revisions, recovery metadata, duplicate keys, streaming and app-owned acknowledgments. The three Calendar connection frontend checks passed after the recovery wording update.

Eight successful real Luna turns used a wholly fictional ceramics scenario and an isolated native Hermes database. Six covered commitment creation, hesitation, a competing activity, a usage question, pushback and editing the quantity. Two checked an explicitly requested brief: the model summarized the saved fictional commitment and disclosed that inbox/calendar content was unavailable. These are behavior checks, not proof of motivation or habit outcomes.

The user's actual failed response was replayed locally through binding and publication validation: the original conversational reply was recovered, no task changed, and no model call was made. The personal transcript was not replayed to a provider. The native app restarted while idle; its ten visible messages, saved commitment and conversation identity matched their pre-restart fingerprints. Old messages were not rewritten.

The broader product requirement is [Personal Companion requests](companion-requests.md): real tools and source-backed catch-ups, not a prompt-only imitation.

## Calendar recovery found during verification

The network reader used a single aiohttp read(n), which can return an available fragment rather than a complete body. Real API comparison reproduced JSON decoding failures despite valid Google access. The reader now accumulates chunks through EOF within the existing two-megabyte cap. Three stream tests cover split JSON/UTF-8 and the cumulative limit. A Retry sync control revalidates only the existing grant and selected sources, and marks connected only after Google accepts the reads. The native app successfully recovered 42 events from four selected calendars without another OAuth grant; saved conversation and tasks were preserved.
