import { AlertTriangle } from 'lucide-react';
import { Card, CardBody } from './Card';
import { Button } from './Button';
export function ErrorAlert({ message = 'Something went wrong. Please try again.', onRetry, }) {
    return (<Card className="relative bg-red-300/50">
      <CardBody className="">
        <div className="flex flex-col items-end md:items-center text-center gap-3">
          <AlertTriangle className="w-20 h-20 text-white/80 absolute top-2 left-2"/>
          <div className="text-gray-700">{message}</div>
          {onRetry && (<Button className="bg-white" variant="secondary" size="sm" onClick={onRetry}>
              Try Again
            </Button>)}
        </div>
      </CardBody>
    </Card>);
}
