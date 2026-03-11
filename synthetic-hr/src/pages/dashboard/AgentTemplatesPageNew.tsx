import { useState } from 'react';
import { Plus, ChevronDown, Star, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AGENT_TEMPLATES = [
  {
    id: 'support',
    name: 'Support Agent',
    description: 'AI-powered customer support with ticket routing',
    icon: '🎧',
    category: 'customer-service',
  },
  {
    id: 'sales',
    name: 'Sales Agent',
    description: 'Lead qualification and sales engagement automation',
    icon: '💼',
    category: 'sales',
  },
  {
    id: 'hr',
    name: 'HR Agent',
    description: 'Employee onboarding and HR policy automation',
    icon: '👥',
    category: 'human-resources',
  },
  {
    id: 'legal',
    name: 'Legal Agent',
    description: 'Contract review and compliance checking',
    icon: '⚖️',
    category: 'legal',
  },
  {
    id: 'finance',
    name: 'Finance Agent',
    description: 'Invoice processing and financial reporting',
    icon: '💰',
    category: 'finance',
  },
  {
    id: 'it',
    name: 'IT Support Agent',
    description: 'Ticket management and troubleshooting',
    icon: '🔧',
    category: 'it-support',
  },
];

const AI_MODELS = [
  { name: 'GPT-4 Turbo', provider: 'openai', key: 'gpt-4-turbo' },
  { name: 'GPT-4o', provider: 'openai', key: 'gpt-4o' },
  { name: 'Claude 3 Opus', provider: 'anthropic', key: 'claude-3-opus' },
  { name: 'Claude 3.5 Sonnet', provider: 'anthropic', key: 'claude-3.5-sonnet' },
  { name: 'Llama 3.1 70B', provider: 'meta', key: 'llama-3.1-70b' },
  { name: 'Mistral Large', provider: 'mistral', key: 'mistral-large' },
];

const AI_PROVIDERS = [
  { name: 'OpenAI', id: 'openai' },
  { name: 'Anthropic', id: 'anthropic' },
  { name: 'Meta', id: 'meta' },
  { name: 'Mistral', id: 'mistral' },
];

export default function AgentTemplatesPage() {
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [expandedModels, setExpandedModels] = useState<boolean>(false);

  const filteredModels = selectedProvider
    ? AI_MODELS.filter((m) => m.provider === selectedProvider)
    : AI_MODELS;

  const displayModels = expandedModels ? filteredModels : filteredModels.slice(0, 4);
  const hasMoreModels = filteredModels.length > 4;

  const handleSelectModel = (modelKey: string) => {
    navigate(`/dashboard/create-agent?template=${selectedTemplate}&model=${modelKey}`);
  };

  const handleCreateCustom = () => {
    navigate('/dashboard/create-agent?type=custom');
  };

  const template = AGENT_TEMPLATES.find((t) => t.id === selectedTemplate);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Agent Templates</h1>
        <p className="text-gray-600">Choose a pre-built template to deploy specialized AI agents instantly</p>
      </div>

      {!selectedTemplate ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {AGENT_TEMPLATES.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedTemplate(agent.id)}
              className="text-left bg-white rounded-lg border border-gray-200 p-6 hover:border-blue-300 hover:shadow-lg transition"
            >
              <div className="text-3xl mb-3">{agent.icon}</div>
              <h3 className="font-semibold text-gray-900 mb-2">{agent.name}</h3>
              <p className="text-sm text-gray-600">{agent.description}</p>
              <div className="mt-4 flex items-center text-blue-600 text-sm font-medium">
                Configure <ChevronDown size={14} className="ml-1" />
              </div>
            </button>
          ))}

          <button
            onClick={handleCreateCustom}
            className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-6 hover:border-blue-400 hover:bg-blue-50 transition flex flex-col items-center justify-center text-center"
          >
            <Plus size={32} className="text-gray-400 mb-3" />
            <h3 className="font-semibold text-gray-900 mb-2">Create Custom</h3>
            <p className="text-sm text-gray-600">Build your own AI agent from scratch</p>
          </button>
        </div>
      ) : null}

      {selectedTemplate && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>{template?.icon}</span>
                {template?.name}
              </h2>
              <p className="text-gray-600 mt-1">{template?.description}</p>
            </div>
            <button
              onClick={() => {
                setSelectedTemplate(null);
                setSelectedProvider(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Select AI Provider & Model</h3>

            {/* Provider Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">Provider</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {AI_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setSelectedProvider(selectedProvider === provider.id ? null : provider.id)}
                    className={`p-3 rounded-lg border-2 transition ${
                      selectedProvider === provider.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="font-medium text-sm">{provider.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Model</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {displayModels.map((model) => (
                  <button
                    key={model.key}
                    onClick={() => handleSelectModel(model.key)}
                    className="text-left p-3 border border-gray-300 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition"
                  >
                    <div className="font-medium text-gray-900">{model.name}</div>
                    <div className="text-xs text-gray-500 capitalize">{model.provider}</div>
                  </button>
                ))}
              </div>
              {hasMoreModels && (
                <button
                  onClick={() => setExpandedModels(!expandedModels)}
                  className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                >
                  <ChevronDown size={16} className={expandedModels ? 'rotate-180' : ''} />
                  {expandedModels ? 'Show less' : `+${filteredModels.length - 4} more models`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
