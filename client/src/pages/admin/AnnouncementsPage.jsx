import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight, Calendar, } from 'lucide-react';
import { adminApi, } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Card, CardBody, Badge, Modal, ErrorAlert, SkeletonCard, EmptyState, } from '../../components/ui';
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}
function truncate(str, max) {
    if (str.length <= max)
        return str;
    return str.slice(0, max).trimEnd() + '...';
}
function AnnouncementFormModal({ isOpen, onClose, announcement }) {
    const queryClient = useQueryClient();
    const isEdit = !!announcement;
    const [title, setTitle] = useState(announcement?.title || '');
    const [content, setContent] = useState(announcement?.content || '');
    const [isActive, setIsActive] = useState(announcement?.is_active ?? true);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormError('');
        if (!title.trim()) {
            setFormError('Title is required.');
            return;
        }
        if (!content.trim()) {
            setFormError('Content is required.');
            return;
        }
        setSubmitting(true);
        try {
            if (isEdit && announcement) {
                const res = await adminApi.updateAnnouncement(announcement.id, {
                    title: title.trim(),
                    content: content.trim(),
                    is_active: isActive,
                });
                if (res.error) {
                    setFormError(res.error);
                }
                else {
                    queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
                    onClose();
                }
            }
            else {
                const res = await adminApi.createAnnouncement({
                    title: title.trim(),
                    content: content.trim(),
                    is_active: isActive,
                });
                if (res.error) {
                    setFormError(res.error);
                }
                else {
                    queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
                    onClose();
                }
            }
        }
        catch {
            setFormError('An unexpected error occurred.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (<Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Announcement' : 'Create Announcement'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (<div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {formError}
          </div>)}

        <div className="w-full">
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" className="block w-full px-3 py-2 border border-gray-300 rounded-none shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F06010] focus:border-[#F06010] sm:text-sm"/>
        </div>

        <div className="w-full">
          <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea required rows={5} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write the announcement content..." className="block w-full px-3 py-2 border border-gray-300 rounded-none shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F06010] focus:border-[#F06010] sm:text-sm resize-y"/>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setIsActive((v) => !v)} className="flex items-center gap-2 text-sm">
            {isActive ? (<ToggleRight className="w-8 h-8 text-green-600"/>) : (<ToggleLeft className="w-8 h-8 text-gray-400"/>)}
            <span className={isActive ? 'text-green-700 font-medium' : 'text-gray-500'}>
              {isActive ? 'Active' : 'Inactive'}
            </span>
          </button>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-none">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting} className="rounded-none">
            {isEdit ? 'Save Changes' : 'Publish'}
          </Button>
        </div>
      </form>
    </Modal>);
}
function DeleteConfirmModal({ isOpen, onClose, announcement }) {
    const queryClient = useQueryClient();
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const handleDelete = async () => {
        if (!announcement)
            return;
        setDeleting(true);
        setDeleteError('');
        const res = await adminApi.deleteAnnouncement(announcement.id);
        if (res.error) {
            setDeleteError(res.error);
            setDeleting(false);
        }
        else {
            queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
            setDeleting(false);
            onClose();
        }
    };
    return (<Modal isOpen={isOpen} onClose={onClose} title="Delete Announcement" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-[#0D2654]">
            &ldquo;{announcement?.title}&rdquo;
          </span>
          ? This action cannot be undone.
        </p>
        {deleteError && (<div className="bg-red-50 border border-red-200 rounded-none p-3 text-sm text-red-700">
            {deleteError}
          </div>)}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} className="rounded-none">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting} className="rounded-none">
            Delete
          </Button>
        </div>
      </div>
    </Modal>);
}
// ─── Main Page ───────────────────────────────────────
export function AnnouncementsPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const limit = 20;
    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState(null);
    const [deletingAnnouncement, setDeletingAnnouncement] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const { data, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['admin', 'announcements', page, limit],
        queryFn: () => adminApi.getAnnouncements(page, limit),
    });
    const announcements = data?.announcements || [];
    const pagination = data?.pagination;
    const handleToggleActive = async (ann) => {
        setTogglingId(ann.id);
        await adminApi.updateAnnouncement(ann.id, { is_active: !ann.is_active });
        queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
        setTogglingId(null);
    };
    return (<div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <Megaphone className="w-6 h-6 text-[#F06010]"/>
          Announcements
        </h1>
        <Button variant="primary" onClick={() => setShowCreateModal(true)} className="rounded-none gap-2">
          <Plus className="w-4 h-4"/>
          Create Announcement
        </Button>
      </div>

      {/* Error */}
      {isError && (<div className="mb-4">
          <ErrorAlert message={error?.message || 'Failed to load announcements.'} onRetry={() => refetch()}/>
        </div>)}

      {/* Loading */}
      {isLoading && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>)}

      {/* Empty */}
      {!isLoading && announcements.length === 0 && (<Card className="rounded-none border-2 border-[#0D2654]/20">
          <CardBody>
            <EmptyState icon={Megaphone} title="No announcements yet" description="Create your first announcement to keep investors informed." action={<Button variant="primary" onClick={() => setShowCreateModal(true)} className="rounded-none gap-2">
                  <Plus className="w-4 h-4"/>
                  Create Announcement
                </Button>}/>
          </CardBody>
        </Card>)}

      {/* Announcement Cards */}
      {!isLoading && announcements.length > 0 && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {announcements.map((ann) => (<div key={ann.id} className={`bg-white border-2 rounded-none p-5 transition-all duration-150 ${ann.is_active
                    ? 'border-[#0D2654]/20 hover:border-[#F06010]/60'
                    : 'border-gray-200 opacity-70'}`}>
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-base font-bold text-[#0D2654] line-clamp-1 flex-1" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  {ann.title}
                </h3>
                <Badge variant={ann.is_active ? 'green' : 'gray'}>
                  {ann.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              {/* Content Preview */}
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                {truncate(ann.content, 180)}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Calendar className="w-3.5 h-3.5"/>
                  {formatDate(ann.created_at)}
                </div>

                <div className="flex items-center gap-1">
                  {/* Toggle */}
                  <button onClick={() => handleToggleActive(ann)} disabled={togglingId === ann.id} className="p-1.5 hover:bg-gray-100 rounded-none transition-colors disabled:opacity-50" title={ann.is_active ? 'Deactivate' : 'Activate'}>
                    {ann.is_active ? (<ToggleRight className="w-5 h-5 text-green-600"/>) : (<ToggleLeft className="w-5 h-5 text-gray-400"/>)}
                  </button>
                  {/* Edit */}
                  <button onClick={() => setEditingAnnouncement(ann)} className="p-1.5 hover:bg-[#F06010]/10 rounded-none transition-colors" title="Edit announcement">
                    <Pencil className="w-4 h-4 text-[#F06010]"/>
                  </button>
                  {/* Delete */}
                  <button onClick={() => setDeletingAnnouncement(ann)} className="p-1.5 hover:bg-red-100 rounded-none transition-colors" title="Delete announcement">
                    <Trash2 className="w-4 h-4 text-red-500"/>
                  </button>
                </div>
              </div>
            </div>))}
        </div>)}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (<div className="flex items-center justify-between mt-6 px-1">
          <p className="text-sm text-gray-500">
            Showing {(pagination.page - 1) * pagination.limit + 1}--
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} announcements
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-none gap-1">
              <ChevronLeft className="w-4 h-4"/>
              Prev
            </Button>
            <span className="text-sm font-medium text-[#0D2654] px-2">
              {pagination.page} / {pagination.pages}
            </span>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-none gap-1">
              Next
              <ChevronRight className="w-4 h-4"/>
            </Button>
          </div>
        </div>)}

      {/* Modals */}
      {showCreateModal && (<AnnouncementFormModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)}/>)}

      {editingAnnouncement && (<AnnouncementFormModal isOpen={!!editingAnnouncement} onClose={() => setEditingAnnouncement(null)} announcement={editingAnnouncement}/>)}

      <DeleteConfirmModal isOpen={!!deletingAnnouncement} onClose={() => setDeletingAnnouncement(null)} announcement={deletingAnnouncement}/>
    </div>);
}
