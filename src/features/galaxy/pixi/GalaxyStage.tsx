import { Application, Graphics } from "@pixi/react";

export type GalaxyNode = {
  id: string;
  x: number;
  y: number;
  ownerColor: string;
};

export type GalaxyLink = {
  fromId: string;
  toId: string;
};

export function GalaxyStage({
  nodes,
  links,
}: {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
}) {
  return (
    <Application
      width={760}
      height={520}
      backgroundColor={"#080d1e"}
      antialias={true}
      resizeTo={undefined}
    >
      <Graphics draw={(graphics) => drawBackground(graphics)} />
      <Graphics draw={(graphics) => drawLinks(graphics, nodes, links)} />
      {nodes.map((node) => (
        <Graphics key={node.id} draw={(graphics) => drawNode(graphics, node)} />
      ))}
    </Application>
  );
}

function drawBackground(graphics: Graphics) {
  graphics.clear();
  graphics.beginFill(0x080d1e);
  graphics.drawRect(0, 0, 760, 520);
  graphics.endFill();
}

function drawLinks(graphics: Graphics, nodes: GalaxyNode[], links: GalaxyLink[]) {
  graphics.clear();
  graphics.lineStyle({ width: 2, color: 0x334155, alpha: 0.85 });
  for (const link of links) {
    const { fromId, toId } = link;
    const from = nodes.find((node) => node.id === fromId);
    const to = nodes.find((node) => node.id === toId);
    if (!from || !to) continue;
    graphics.moveTo(from.x, from.y);
    graphics.lineTo(to.x, to.y);
  }
}

function drawNode(graphics: Graphics, node: GalaxyNode) {
  graphics.clear();
  graphics.beginFill(parseInt(node.ownerColor.replace("#", "0x"), 16));
  graphics.drawCircle(node.x, node.y, 14);
  graphics.endFill();
  graphics.lineStyle({ width: 3, color: 0xe2e8f0, alpha: 0.8 });
  graphics.drawCircle(node.x, node.y, 19);
}
