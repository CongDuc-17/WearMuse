type LayoutInput = {
  width: number;
  insets: { left: number; right: number; bottom: number };
};

export function getFloatingNavLayout({ width, insets }: LayoutInput) {
  const horizontalInset = (width < 375 ? 16 : 24) + Math.max(insets.left, insets.right);
  const maxWidth = 560;
  // HeroUI Tabs.List adds 3px padding around the 48px icon touch targets.
  const barPadding = 3;
  const barHeight = 48 + barPadding * 2;
  const bottomOffset = insets.bottom + 12;

  return {
    bottomOffset,
    barHeight,
    horizontalInset,
    contentInset: bottomOffset + barHeight + 12,
    barPadding,
    maxWidth,
  };
}
