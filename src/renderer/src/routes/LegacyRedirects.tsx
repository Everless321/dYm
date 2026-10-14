import { Navigate, useLocation, useParams } from 'react-router-dom'

export function LegacyAnalysisRedirect(): React.JSX.Element {
  const location = useLocation()
  return <Navigate to={`/library/jobs${location.search}`} replace />
}

export function LegacyTagRedirect(): React.JSX.Element {
  const location = useLocation()
  return <Navigate to={`/library/videos${location.search}`} replace />
}

export function TagUserRedirect(): React.JSX.Element {
  const { secUid = '' } = useParams()
  return <Navigate to={`/library/videos?user=${encodeURIComponent(secUid)}`} replace />
}
