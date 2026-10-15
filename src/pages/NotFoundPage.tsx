import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      className="py-24"
      action={
        <Button asChild>
          <Link to="/">Go to dashboard</Link>
        </Button>
      }
    />
  )
}
