export function Skeleton({ variant = 'text', width, height, className = '', }) {
    const baseClasses = 'bg-gradient-to-r from-paper-deep via-paper to-paper-deep bg-[length:200%_100%] animate-shimmer';
    const variantClasses = {
        text: 'h-4 w-full',
        circular: 'rounded-full',
        rectangular: '',
    };
    const style = {};
    if (width)
        style.width = typeof width === 'number' ? `${width}px` : width;
    if (height)
        style.height = typeof height === 'number' ? `${height}px` : height;
    return (<div className={`${baseClasses} ${variantClasses[variant]} ${className}`} style={style}/>);
}
export function SkeletonCard() {
    return (<div className="bg-white border border-line p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40}/>
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="w-3/4 h-5"/>
          <Skeleton variant="text" className="w-1/2 h-3"/>
        </div>
      </div>
      <Skeleton variant="rectangular" height={12}/>
      <Skeleton variant="rectangular" height={12} className="w-2/3"/>
    </div>);
}
