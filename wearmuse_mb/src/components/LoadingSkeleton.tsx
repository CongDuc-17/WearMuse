import { Skeleton, type SkeletonProps } from 'heroui-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = Pick<SkeletonProps, 'style' | 'className' | 'testID'>;

/** Use the supported pulse variant to avoid the previously failing shimmer path. */
export function LoadingSkeleton(props: Props) {
  const reducedMotion = useReducedMotion();
  return <Skeleton {...props} variant={reducedMotion ? 'none' : 'pulse'} animation={reducedMotion ? 'disable-all' : undefined} />;
}
