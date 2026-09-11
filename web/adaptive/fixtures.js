import { SOURCE_WIDGET_SAMPLE } from '../preview/fixtures.js';

const component = (id, kind, title, emphasis, text, items, binding) => ({
  id,
  kind,
  title,
  emphasis,
  ...(text ? { text } : {}),
  ...(items ? { items } : {}),
  ...(binding ? { binding } : {}),
});
const composition = (id, title, components) => ({
  schema_version: 1,
  id,
  context_id: `${id}-context`,
  revision: 1,
  title,
  components,
});

export const adaptiveFixtures = Object.freeze({
  writing: composition('writing-brief', 'Draft the neighborhood project brief', [
    component(
      'intention',
      'intention',
      'The thread to hold',
      'primary',
      'Set the project’s purpose in one clear opening before refining the rest.',
    ),
    component(
      'resume',
      'resume',
      'Where you left it',
      'normal',
      'The opening is drafted and one transition is marked to revisit.',
    ),
    component('outline', 'outline', 'Shape', 'normal', null, [
      'Purpose',
      'Who it serves',
      'What happens next',
    ]),
    component('note', 'note', 'Scratchpad', 'quiet', 'A detail I can see:'),
  ]),
  travel: composition('travel-weekend', 'Choose a quiet weekend in Joshua Tree', [
    component('comparison', 'comparison', 'Stay options', 'primary', null, [
      {
        id: 'a',
        label: 'Desert Willow Inn',
        detail: 'Walkable dinner, quiet rooms',
        value: '$188',
      },
      {
        id: 'b',
        label: 'Mojave Sands',
        detail: 'Kitchenette, farther from the park',
        value: '$164',
      },
    ]),
    component('timeline', 'timeline', 'Trip shape', 'normal', null, [
      { id: 'fri', label: 'Friday', detail: 'Arrive before sunset', duration: 2 },
      { id: 'sat', label: 'Saturday', detail: 'Keys View at first light', duration: 5 },
      { id: 'sun', label: 'Sunday', detail: 'Breakfast and drive home', duration: 2 },
    ]),
    component('resources', 'resources', 'Known sources', 'quiet', null, null, {
      id: 'travel-sources',
    }),
  ]),
  creative: composition('creative-short-film', 'Plan the short film shoot', [
    component(
      'intention',
      'intention',
      'The scene',
      'primary',
      'Capture the first take before chasing a perfect lighting plan.',
    ),
    component('stages', 'stages', 'Production beats', 'normal', null, [
      { id: 'location', label: 'Scout the laundromat', status: 'next' },
      { id: 'shotlist', label: 'Mark five essential frames' },
      { id: 'sound', label: 'Record room tone' },
    ]),
    component('note', 'note', 'Visual notes', 'quiet', 'Blue detergent aisle; patient camera.'),
  ]),
  admin: composition('admin-insurance', 'Finish the insurance paperwork', [
    component(
      'resume',
      'resume',
      'Return point',
      'primary',
      'The form is open. The remaining question is whether the receipt needs an itemized copy.',
    ),
    component('resources', 'resources', 'Documents on hand', 'normal', null, null, {
      id: 'insurance-documents',
    }),
    component('connections', 'connections', 'Tracking', 'quiet', null, null, {
      id: 'source-status',
    }),
  ]),
  study: composition('study-patterns', 'Review interface patterns', [
    component('outline', 'outline', 'Study pass', 'primary', null, [
      'Read the examples',
      'Compare the interaction patterns',
      'Write two open questions',
    ]),
    component('usage', 'usage', 'Browser usage', 'quiet', null, null, {
      id: 'study-context',
    }),
    component('note', 'note', 'Question parking lot', 'normal', ''),
  ]),
  coding: composition('coding-parser', 'Repair the CSV parser', [
    component(
      'resume',
      'resume',
      'Current signal',
      'primary',
      'The failing input has a quoted comma; keep the existing happy path intact.',
    ),
    component('stages', 'stages', 'Small route', 'normal', null, [
      'Write the failing case',
      'Patch tokenization',
      'Run the parser test',
    ]),
    component('resources', 'resources', 'Relevant files', 'quiet', null, [
      { id: 'parser', label: 'parser.js', detail: 'Current tokenizer' },
      { id: 'test', label: 'parser.test.js', detail: 'Focused regression' },
    ]),
  ]),
});

export const adaptiveFixtureResources = Object.freeze({
  'travel-sources': [
    { id: 'park', label: 'National Park Service', detail: 'Hours and entry details' },
    { id: 'weather', label: 'Forecast', detail: 'Check before packing' },
  ],
  'insurance-documents': [
    { id: 'receipt', label: 'Clinic receipt', status: 'saved' },
    { id: 'claim', label: 'Claim form', status: 'in progress' },
  ],
  'study-context': { widgetView: SOURCE_WIDGET_SAMPLE },
  'source-status': { widgetView: SOURCE_WIDGET_SAMPLE },
});
