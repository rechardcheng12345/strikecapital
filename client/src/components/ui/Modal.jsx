import React, { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
export function Modal({ isOpen, onClose, title, children, size = 'md' }) {
    const sizeClasses = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '4xl': 'max-w-4xl',
    };
    return (<Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-ink-950/45 backdrop-blur-[3px]"/>
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 translate-y-3" enterTo="opacity-100 translate-y-0" leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-2">
              <Dialog.Panel className={`w-full ${sizeClasses[size]} transform overflow-hidden rounded-none bg-white p-6 sm:p-7 shadow-float border border-line transition-all`}>
                {title && (<div className="flex items-start justify-between gap-4 mb-5 pb-4 border-b border-line">
                    <Dialog.Title className="font-display text-[22px] leading-tight text-ink">
                      {title}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-ink/40 hover:text-ink hover:bg-ink/5 p-1.5 -mr-1.5 transition-colors" aria-label="Close">
                      <X className="w-5 h-5"/>
                    </button>
                  </div>)}
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>);
}
