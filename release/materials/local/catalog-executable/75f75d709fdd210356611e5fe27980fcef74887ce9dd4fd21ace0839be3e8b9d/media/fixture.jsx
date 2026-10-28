// Catalog-authored two-frame composition; no remote fonts, assets or account access.
import React from 'react';
import {Composition, registerRoot, AbsoluteFill, useCurrentFrame} from 'remotion';
function Frame() {
  const frame=useCurrentFrame();
  return <AbsoluteFill style={{backgroundColor:frame===0?'red':'blue'}} />;
}
registerRoot(()=> <Composition id="Fixture" component={Frame} durationInFrames={2}
  fps={1} width={64} height={64} />);
