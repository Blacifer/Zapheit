import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
    children: React.ReactNode;
    fallbackMessage?: string;
    onRetry?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class SectionErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('Section error caught:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
        if (this.props.onRetry) {
            this.props.onRetry();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="w-full flex items-center justify-center p-8 bg-slate-800/30 border border-red-500/20 rounded-xl">
                    <div className="text-center max-w-md">
                        <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertCircle className="w-6 h-6 text-red-400" />
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">
                            {this.props.fallbackMessage || 'Failed to load this section'}
                        </h3>
                        <p className="text-sm text-slate-400 mb-6 px-4">
                            {this.state.error?.message || 'An unexpected error occurred while rendering this view.'}
                        </p>
                        <button
                            onClick={this.handleRetry}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
