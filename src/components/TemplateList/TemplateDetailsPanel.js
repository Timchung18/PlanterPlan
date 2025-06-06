import React, { useState, useEffect } from 'react';
import { getBackgroundColor, getTaskLevel } from '../../utils/taskUtils';
import TemplateTaskForm from '../TaskForm/TemplateTaskForm';

const TemplateDetailsPanel = ({
  task,
  tasks,
  onClose,
  onAddTask,
  onDeleteTask,
  onEditTask
}) => {
  // State for edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [hasChildren, setHasChildren] = useState(false);
  
  // Check if this task has children
  useEffect(() => {
    if (task && task.id && Array.isArray(tasks)) {
      // Find children of this task
      const children = tasks.filter(t => t.parent_task_id === task.id);
      const childExists = children.length > 0;
      setHasChildren(childExists);
    }
  }, [task, tasks]);
  
  // Button handlers
  const handleEditClick = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleTemplateUpdate = (updatedTaskData) => {
    onEditTask(task.id, updatedTaskData);
    setIsEditing(false);
  };
  
  if (!task) return null;
  
  const level = getTaskLevel(task, tasks);
  const backgroundColor = getBackgroundColor(level);

  // Find parent task for displaying parent-child relationships
  const parentTask = task.parent_task_id ? tasks.find(t => t.id === task.parent_task_id) : null;
  
  // Find children for this task, sorted by position for sequential display
  const children = tasks
    .filter(t => t.parent_task_id === task.id)
    .sort((a, b) => a.position - b.position);
  
  // Edit mode
  if (isEditing) {
    return (
      <TemplateTaskForm
        initialData={task}
        parentTaskId={task.parent_task_id}
        onSubmit={handleTemplateUpdate}
        onCancel={handleCancelEdit}
        backgroundColor={backgroundColor}
        isEditing={true}
        tasks={tasks}
      />
    );
  }
  
  // Ensure arrays are valid
  const actions = Array.isArray(task.actions) ? task.actions : [];
  const resources = Array.isArray(task.resources) ? task.resources : [];
  
  // Format dates for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return 'Not set';
    
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return 'Invalid date';
    }
  };
  
  // Get duration values
  const defaultDuration = task.default_duration || 1;
  const durationDays = task.duration_days || 1;
  
  return (
    <div className="template-details-panel" style={{
      backgroundColor: '#f9fafb',
      borderRadius: '4px',
      border: '1px solid #e5e7eb',
      height: '100%',
      overflow: 'auto'
    }}>
      <div className="details-header" style={{
        backgroundColor: backgroundColor,
        color: 'white',
        padding: '16px',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '4px',
        position: 'relative'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h3 style={{ 
              margin: 0, 
              fontWeight: 'bold',
            }}>
              {task.title}
            </h3>
          </div>
          
          <button 
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '50%',
              color: 'white',
              cursor: 'pointer',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px'
            }}
          >
            ✕
          </button>
        </div>
      </div>
      
      <div className="details-content" style={{ padding: '16px' }}>
        {/* Template Type Badge */}
        <div style={{ 
          display: 'inline-block',
          backgroundColor: '#e0f2fe',
          color: '#0369a1',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: 'bold',
          marginBottom: '16px'
        }}>
          Template
        </div>
        
        {/* Enhanced schedule information section */}
        <div className="schedule-info-section" style={{ 
          backgroundColor: '#f0f9ff', 
          borderRadius: '4px',
          padding: '12px',
          marginTop: '16px'
        }}>
          <h4 style={{ fontWeight: 'bold', marginBottom: '8px', marginTop: '0' }}>Schedule Details</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Default Duration */}
            <div>
              <span style={{ fontSize: '12px', color: '#4b5563' }}>Default Duration</span>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center',
                marginTop: '4px',
                gap: '6px'
              }}>
                <p style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold', 
                  margin: '0',
                  color: '#000'
                }}>
                  {defaultDuration} day{defaultDuration !== 1 ? 's' : ''}
                </p>
                
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  borderRadius: '10px',
                  fontWeight: 'bold'
                }}>
                  DEFAULT
                </span>
              </div>
            </div>
            
            {/* Duration Days (Calculated/Minimum) */}
            <div>
              <span style={{ fontSize: '12px', color: '#4b5563' }}>
                {hasChildren ? 'Calculated Duration' : 'Minimum Duration'}
              </span>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center',
                marginTop: '4px',
                gap: '6px'
              }}>
                <p style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold', 
                  margin: '0',
                  color: '#000'
                }}>
                  {durationDays} day{durationDays !== 1 ? 's' : ''}
                </p>
                
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  backgroundColor: hasChildren ? '#93c5fd' : '#fbbf24',
                  color: hasChildren ? '#1e40af' : '#92400e',
                  borderRadius: '10px',
                  fontWeight: 'bold'
                }}>
                  {hasChildren ? 'CALCULATED' : 'MINIMUM'}
                </span>
              </div>
              
              {/* Helper text */}
              <p style={{ 
                fontSize: '11px', 
                color: '#6b7280', 
                margin: '4px 0 0 0',
                fontStyle: 'italic'
              }}>
                {hasChildren 
                  ? 'Based on child tasks' 
                  : 'Minimum time to complete this task'
                }
              </p>
            </div>
          </div>
          
          {/* Position in parent */}
          <div style={{ marginTop: '12px' }}>
            <span style={{ fontSize: '12px', color: '#4b5563' }}>Position</span>
            <p style={{ 
              fontSize: '16px', 
              fontWeight: 'bold', 
              margin: '4px 0 0 0'
            }}>
              {task.position !== undefined ? task.position + 1 : 'Not set'}
              {parentTask && <span style={{fontSize: '12px', color: '#6b7280'}}> (in sequence)</span>}
            </p>
          </div>
          
          {/* Child Tasks Timeline */}
          {hasChildren && (
            <div style={{ marginTop: '16px' }}>
              <h5 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold' }}>
                Child Tasks
              </h5>
              <div style={{ 
                fontSize: '14px', 
                backgroundColor: 'white', 
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                padding: '8px'
              }}>
                <ol style={{ 
                  margin: '0',
                  padding: '0 0 0 16px'
                }}>
                  {children.map((child, index) => {
                    const childHasChildren = tasks.some(t => t.parent_task_id === child.id);
                    const childDefaultDuration = child.default_duration || 1;
                    const childDurationDays = child.duration_days || 1;
                    
                    return (
                      <li key={child.id} style={{ marginBottom: '6px' }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          backgroundColor: index % 2 === 0 ? '#f9fafb' : 'white',
                          borderRadius: '2px'
                        }}>
                          <span style={{ fontWeight: 'bold' }}>{child.title}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {/* Show both durations if different */}
                            {childDefaultDuration !== childDurationDays ? (
                              <>
                                <span style={{ color: '#6b7280', fontSize: '11px' }}>
                                  Default: {childDefaultDuration}d
                                </span>
                                <span style={{ color: '#000', fontSize: '12px', fontWeight: 'bold' }}>
                                  {childDurationDays} day{childDurationDays !== 1 ? 's' : ''}
                                </span>
                                <span style={{
                                  fontSize: '9px',
                                  padding: '1px 4px',
                                  backgroundColor: childHasChildren ? '#93c5fd' : '#fbbf24',
                                  color: childHasChildren ? '#1e40af' : '#92400e',
                                  borderRadius: '8px',
                                  fontWeight: 'bold'
                                }}>
                                  {childHasChildren ? 'CALC' : 'MIN'}
                                </span>
                              </>
                            ) : (
                              <span style={{ color: '#6b7280', fontSize: '12px' }}>
                                {childDurationDays} day{childDurationDays !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Show an arrow connecting tasks if not the last one */}
                        {index < children.length - 1 && (
                          <div style={{ 
                            textAlign: 'center', 
                            padding: '2px 0',
                            color: '#9ca3af'
                          }}>
                            ↓
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
          
          {/* Parent template name if applicable */}
          {parentTask && (
            <div style={{ marginTop: '12px', fontSize: '14px' }}>
              <span style={{ color: '#4b5563' }}>Parent Template: </span>
              <span style={{ fontWeight: 'bold' }}>{parentTask.title}</span>
            </div>
          )}
        </div>
        
        {/* Created/Modified dates */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: '12px', 
          color: '#6b7280',
          marginTop: '12px'
        }}>
          {task.created_at && (
            <div>Created: {formatDisplayDate(task.created_at)}</div>
          )}
          {task.last_modified && (
            <div>Last modified: {formatDisplayDate(task.last_modified)}</div>
          )}
        </div>
        
        <div className="detail-row">
          <h4 style={{ fontWeight: 'bold', marginBottom: '4px', marginTop: '16px' }}>Purpose:</h4>
          <p>{task.purpose || 'No purpose specified'}</p>
        </div>
        
        <div className="detail-row">
          <h4 style={{ fontWeight: 'bold', marginBottom: '4px', marginTop: '16px' }}>Description:</h4>
          <p>{task.description || 'No description specified'}</p>
        </div>
        
        <div className="detail-row">
          <h4 style={{ fontWeight: 'bold', marginBottom: '4px', marginTop: '16px' }}>Actions:</h4>
          <ul style={{ paddingLeft: '20px', margin: '8px 0 0 0' }}>
            {actions.length > 0 ? 
              actions.map((action, index) => (
                <li key={index}>{action}</li>
              )) : 
              <li>No actions specified</li>
            }
          </ul>
        </div>
        
        <div className="detail-row">
          <h4 style={{ fontWeight: 'bold', marginBottom: '4px', marginTop: '16px' }}>Resources:</h4>
          <ul style={{ paddingLeft: '20px', margin: '8px 0 0 0' }}>
            {resources.length > 0 ? 
              resources.map((resource, index) => (
                <li key={index}>{resource}</li>
              )) : 
              <li>No resources specified</li>
            }
          </ul>
        </div>
        
        {/* Action buttons */}
        <div className="detail-row" style={{ 
          marginTop: '24px', 
          display: 'flex', 
          gap: '12px'
        }}>
          {/* Edit Template Button */}
          <button
            onClick={handleEditClick}
            style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              border: 'none',
              flex: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span style={{ marginRight: '8px' }}>Edit Template</span>
            <span>✎</span>
          </button>
          
          {/* Add Child Template button */}
          <button
            onClick={() => onAddTask(task.id)}
            style={{
              backgroundColor: '#10b981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              border: 'none',
              flex: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span style={{ marginRight: '8px' }}>Add Child Template</span>
            <span>+</span>
          </button>
        </div>
        
        {/* Delete Template button - separate row */}
        <div className="detail-row" style={{ 
          marginTop: '12px'
        }}>
          <button
            onClick={() => onDeleteTask(task.id)}
            style={{
              backgroundColor: '#ef4444',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              border: 'none',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            Delete Template
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateDetailsPanel;